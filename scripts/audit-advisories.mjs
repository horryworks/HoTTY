#!/usr/bin/env node
// Frontend advisory gate — the npm-side counterpart to `cargo deny check advisories`.
//
// WHY THIS EXISTS (rather than calling `npm audit` directly):
//
//   1. `npm audit` is not reliable against the live registry. The bulk-advisory
//      endpoint intermittently returns a GZIP body while omitting the
//      `Content-Encoding: gzip` header (observed 2026-07-26, Cloudflare KIX edge).
//      npm then JSON-parses raw gzip and dies with
//      `invalid json response body ... Unexpected token '\x1f'` — 0x1f8b being the
//      gzip magic number. It is edge-dependent and transient, so it can break a
//      release at any moment for reasons that have nothing to do with this repo.
//      We sniff the body and decompress it ourselves, and retry on transient faults.
//
//   2. `npm audit` has no reviewed-and-accepted mechanism. `cargo deny` has
//      `[advisories] ignore` with a reason; the project's security policy requires
//      accepted risk to be *recorded*, never silently skipped. `audit-ignore.json`
//      provides the same discipline here, and additionally REQUIRES an expiry date
//      so an acceptance cannot quietly become permanent.
//
//   3. An unreachable registry must never look like a clean audit. `npm audit`
//      exits non-zero for both "found vulnerabilities" and "could not run", which
//      makes fail-open easy to write by accident. This exits 1 only for real
//      findings and 2 for tooling failure, so callers can tell them apart.
//
// Node built-ins only — no new npm dependency, so the supply-chain lockfile
// policy is untouched (same rule as generate-third-party-licenses.mjs).
//
// Usage:
//   node scripts/audit-advisories.mjs [--audit-level=moderate] [--json]
// Exit codes:
//   0 = clean (or only findings below threshold / actively ignored)
//   1 = one or more findings at/above threshold
//   2 = the audit could not be completed (network, decode, malformed lockfile)

import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync, inflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const LOCKFILE = join(repoRoot, 'package-lock.json');
const IGNORE_FILE = join(repoRoot, 'audit-ignore.json');

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'];
const RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 3000, 8000];
const REQUEST_TIMEOUT_MS = 60_000;

// --- args -------------------------------------------------------------------

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const levelArg = args.find((a) => a.startsWith('--audit-level='));
const threshold = levelArg ? levelArg.split('=')[1] : 'moderate';
if (!SEVERITY_ORDER.includes(threshold)) {
  console.error(`audit: unknown --audit-level "${threshold}" (expected one of ${SEVERITY_ORDER.join(', ')})`);
  process.exit(2);
}
const thresholdRank = SEVERITY_ORDER.indexOf(threshold);

/** Registry honours .npmrc's pin via npm's env, else the public default. */
const registry = (
  process.env.npm_config_registry ||
  process.env.NPM_CONFIG_REGISTRY ||
  'https://registry.npmjs.org/'
).replace(/\/+$/, '');

// --- lockfile ---------------------------------------------------------------

/**
 * Build the `{ name: [versions] }` map the bulk endpoint expects, plus per-package
 * metadata used for triage: which lockfile paths introduced it, and whether every
 * one of those paths is dev-only (a dev-only advisory does not ship to users).
 */
function readLockfile() {
  if (!existsSync(LOCKFILE)) {
    throw new Error(`package-lock.json not found at ${LOCKFILE}`);
  }
  const lock = JSON.parse(readFileSync(LOCKFILE, 'utf8'));
  if (!lock.packages) {
    throw new Error('package-lock.json has no "packages" map (lockfileVersion >= 2 required)');
  }

  const versions = new Map(); // name -> Set(version)
  const paths = new Map(); // name -> [lock path]
  const prod = new Map(); // name -> bool (reachable outside devDependencies)

  for (const [path, info] of Object.entries(lock.packages)) {
    if (!path || !info?.version) continue; // "" is the root project
    const name = path.split('node_modules/').pop();
    if (!name) continue;
    if (!versions.has(name)) {
      versions.set(name, new Set());
      paths.set(name, []);
      prod.set(name, false);
    }
    versions.get(name).add(info.version);
    paths.get(name).push(path);
    if (!info.dev) prod.set(name, true);
  }

  const payload = {};
  for (const [name, set] of versions) payload[name] = [...set];
  return { payload, versions, paths, prod };
}

// --- ignore policy ----------------------------------------------------------

/**
 * Reviewed-and-accepted advisories. Mirrors `deny.toml`'s `[advisories] ignore`,
 * but every entry MUST carry an expiry — an acceptance that never expires is
 * indistinguishable from forgetting about it. An expired or malformed entry is
 * reported and the finding counts against the gate again.
 */
function readIgnores() {
  if (!existsSync(IGNORE_FILE)) return { entries: [], problems: [] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(IGNORE_FILE, 'utf8'));
  } catch (e) {
    return { entries: [], problems: [`audit-ignore.json is not valid JSON (${e.message}) — all ignores disregarded`] };
  }
  const problems = [];
  const entries = [];
  for (const raw of parsed.ignore ?? []) {
    if (!raw?.id || !raw?.reason || !raw?.expires) {
      problems.push(`ignore entry ${JSON.stringify(raw?.id ?? raw)} is missing id/reason/expires — disregarded`);
      continue;
    }
    const expires = Date.parse(`${raw.expires}T23:59:59Z`);
    if (Number.isNaN(expires)) {
      problems.push(`ignore entry ${raw.id} has an unparseable expires "${raw.expires}" — disregarded`);
      continue;
    }
    entries.push({ ...raw, expiresAt: expires });
  }
  return { entries, problems };
}

// --- registry fetch ---------------------------------------------------------

/**
 * Decode a response body that may or may not be compressed, and may or may not
 * say so. undici transparently decompresses when `Content-Encoding` is present;
 * the registry bug is that it sometimes is not, so sniff the magic bytes.
 */
function decodeBody(buf) {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf).toString('utf8');
  // zlib/deflate: CMF byte 0x78 with a valid FCHECK
  if (buf.length >= 2 && buf[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(buf[1])) {
    return inflateSync(buf).toString('utf8');
  }
  return buf.toString('utf8');
}

async function fetchAdvisories(payload) {
  const url = `${registry}/-/npm/v1/security/advisories/bulk`;
  let lastError;

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt > 0) {
      const wait = RETRY_BACKOFF_MS[attempt - 1] ?? 8000;
      console.error(`audit: retrying in ${wait}ms (attempt ${attempt + 1}/${RETRIES}) — ${lastError}`);
      await new Promise((r) => setTimeout(r, wait));
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Ask for an uncompressed body: it sidesteps the missing-header bug
          // outright when the CDN honours it. decodeBody() covers it when not.
          'accept-encoding': 'identity',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status >= 500 || res.status === 429) {
        lastError = `registry returned HTTP ${res.status}`;
        continue; // transient — retry
      }
      if (!res.ok) throw new Error(`registry returned HTTP ${res.status}`); // 4xx — not retryable
      const text = decodeBody(Buffer.from(await res.arrayBuffer()));
      return JSON.parse(text);
    } catch (e) {
      lastError = e.message;
      // Network/decode faults are the transient class this wrapper exists for.
    }
  }
  throw new Error(`could not fetch advisories after ${RETRIES} attempts: ${lastError}`);
}

// --- main -------------------------------------------------------------------

async function main() {
  const { payload, versions, paths, prod } = readLockfile();
  const { entries: ignores, problems: ignoreProblems } = readIgnores();
  const advisories = await fetchAdvisories(payload);

  const now = Date.now();
  const active = [];
  const ignored = [];
  const belowThreshold = [];

  for (const [name, list] of Object.entries(advisories)) {
    for (const adv of list) {
      const rank = SEVERITY_ORDER.indexOf(adv.severity);
      const finding = {
        package: name,
        installed: [...(versions.get(name) ?? [])],
        severity: adv.severity,
        title: adv.title,
        url: adv.url,
        vulnerable: adv.vulnerable_versions,
        devOnly: prod.get(name) === false,
        paths: paths.get(name) ?? [],
      };

      if (rank < thresholdRank) {
        belowThreshold.push(finding);
        continue;
      }

      // An ignore matches on advisory id (GHSA-…) or URL, optionally scoped to a package.
      const hit = ignores.find(
        (ig) =>
          (adv.url?.includes(ig.id) || String(adv.id) === String(ig.id)) &&
          (!ig.package || ig.package === name)
      );
      if (hit && hit.expiresAt >= now) {
        ignored.push({ ...finding, reason: hit.reason, expires: hit.expires });
      } else if (hit) {
        active.push({ ...finding, expiredIgnore: hit.expires });
      } else {
        active.push(finding);
      }
    }
  }

  const rankDesc = (a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity);
  active.sort(rankDesc);
  ignored.sort(rankDesc);

  if (asJson) {
    console.log(JSON.stringify({ threshold, active, ignored, belowThreshold, ignoreProblems }, null, 2));
    return active.length > 0 ? 1 : 0;
  }

  console.log(`npm advisory audit — threshold: ${threshold} and above (registry: ${registry})`);
  console.log(`scanned ${Object.keys(payload).length} packages from package-lock.json\n`);

  for (const p of ignoreProblems) console.log(`  !! ${p}`);
  if (ignoreProblems.length) console.log('');

  if (active.length === 0) {
    console.log('  No advisories at or above the threshold.');
  } else {
    console.log(`  ${active.length} finding(s) at or above ${threshold}:\n`);
    for (const f of active) {
      const scope = f.devOnly ? 'devDependency — not shipped' : 'PRODUCTION — ships to users';
      console.log(`  [${f.severity.toUpperCase()}] ${f.package}@${f.installed.join(', ')}  (${scope})`);
      console.log(`      ${f.title}`);
      console.log(`      vulnerable: ${f.vulnerable}`);
      console.log(`      ${f.url}`);
      if (f.expiredIgnore) {
        console.log(`      !! its audit-ignore entry EXPIRED on ${f.expiredIgnore} — re-review or extend it`);
      }
      for (const p of f.paths.slice(0, 4)) console.log(`      via ${p}`);
      if (f.paths.length > 4) console.log(`      …and ${f.paths.length - 4} more path(s)`);
      console.log('');
    }
  }

  if (ignored.length) {
    console.log(`  ${ignored.length} accepted advisory/advisories (audit-ignore.json) — NOT failing the gate:\n`);
    for (const f of ignored) {
      console.log(`  [${f.severity.toUpperCase()}] ${f.package}@${f.installed.join(', ')} — expires ${f.expires}`);
      console.log(`      ${f.reason}`);
      console.log(`      ${f.url}\n`);
    }
  }

  if (belowThreshold.length) {
    const names = [...new Set(belowThreshold.map((f) => `${f.package} (${f.severity})`))];
    console.log(`  ${belowThreshold.length} advisory/advisories below threshold, informational: ${names.join(', ')}`);
  }

  return active.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    // Exit 2, never 1: a gate that could not run must not be mistaken for a
    // clean audit, and must not be confused with a real finding either.
    console.error(`\naudit: FAILED TO RUN — ${e.message}`);
    console.error('audit: this is NOT a pass. Resolve the tooling/network fault and re-run.');
    process.exit(2);
  });
