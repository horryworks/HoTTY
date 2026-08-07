#!/usr/bin/env node
// Generate src-tauri/resources/third-party-licenses.json — the attribution
// manifest shown in-app (Settings → About → Third-Party Licenses) and required
// to satisfy the notice-reproduction terms of bundled MIT/BSD/Apache deps.
//
// Collects two ecosystems with Node built-ins only (no extra npm dependency, so
// the supply-chain lockfile policy is untouched):
//   - npm:  the production dependency tree (`npm ls --omit=dev --all --json`),
//           since only runtime deps are bundled by Vite into the shipped app.
//   - rust: the resolved crate graph (`cargo metadata`), minus our own crate.
// For each package it records name/version/license/repository and, when found
// on disk, the full LICENSE text.
//
// Defensive by design: any failure in one ecosystem is logged and skipped; the
// script ALWAYS writes a file and ALWAYS exits 0, so wiring it into the build
// (package.json `beforeBuildCommand`) can never break a release.

import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const srcTauri = join(repoRoot, 'src-tauri');
const outDir = join(srcTauri, 'resources');
const outFile = join(outDir, 'third-party-licenses.json');

const LICENSE_FILE_RE = /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i;
const MAX_LICENSE_TEXT = 64 * 1024; // cap per-package text so the manifest stays sane

/** Read the first LICENSE-like file found directly in `dir`, truncated. */
function readLicenseText(dir) {
  try {
    if (!dir || !existsSync(dir)) return null;
    const entries = readdirSync(dir, { withFileTypes: true });
    const match = entries.find((e) => e.isFile() && LICENSE_FILE_RE.test(e.name));
    if (!match) return null;
    let text = readFileSync(join(dir, match.name), 'utf8');
    if (text.length > MAX_LICENSE_TEXT) text = text.slice(0, MAX_LICENSE_TEXT) + '\n…(truncated)';
    return text;
  } catch {
    return null;
  }
}

function normalizeRepo(repo) {
  if (!repo) return undefined;
  const url = typeof repo === 'string' ? repo : repo.url;
  if (!url) return undefined;
  return url.replace(/^git\+/, '').replace(/\.git$/, '');
}

// --- npm production dependencies --------------------------------------------
function collectNpm() {
  const packages = [];
  let tree;
  try {
    // Use a shell command string (execSync) rather than execFileSync: on Windows
    // `npm` is `npm.cmd`, which execFileSync cannot spawn directly.
    const json = execSync(
      'npm ls --omit=dev --all --json',
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    tree = JSON.parse(json);
  } catch (e) {
    // `npm ls` exits non-zero on peer-dep warnings but still prints JSON to stdout.
    if (e.stdout) {
      try { tree = JSON.parse(e.stdout.toString()); } catch { /* give up on npm */ }
    }
    if (!tree) {
      console.warn('[licenses] npm: could not enumerate production deps:', e.message);
      return packages;
    }
  }

  const seen = new Set();
  const walk = (node) => {
    const deps = node?.dependencies;
    if (!deps) return;
    for (const [name, info] of Object.entries(deps)) {
      const version = info?.version ?? '';
      const key = `${name}@${version}`;
      if (!seen.has(key)) {
        seen.add(key);
        const pkgDir = join(repoRoot, 'node_modules', name);
        let license;
        let repository;
        try {
          const pj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
          license = typeof pj.license === 'string'
            ? pj.license
            : (pj.license?.type ?? (Array.isArray(pj.licenses) ? pj.licenses.map((l) => l.type).join(' OR ') : undefined));
          repository = normalizeRepo(pj.repository ?? pj.homepage);
        } catch { /* package dir not hoisted to top level; skip text */ }
        packages.push({
          name,
          version,
          ecosystem: 'npm',
          license: license ?? 'UNKNOWN',
          repository,
          licenseText: readLicenseText(pkgDir),
        });
      }
      walk(info);
    }
  };
  walk(tree);
  return packages;
}

// --- Rust crate graph -------------------------------------------------------
function collectRust() {
  const packages = [];
  let meta;
  try {
    const json = execFileSync(
      'cargo',
      ['metadata', '--format-version', '1'],
      { cwd: srcTauri, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    meta = JSON.parse(json);
  } catch (e) {
    console.warn('[licenses] rust: could not run `cargo metadata`:', e.message);
    return packages;
  }

  const workspaceMembers = new Set(meta.workspace_members ?? []);
  for (const pkg of meta.packages ?? []) {
    // Skip our own workspace crate(s) — we are the GPL-3.0 app, not a third party.
    if (workspaceMembers.has(pkg.id)) continue;
    const crateDir = pkg.manifest_path ? dirname(pkg.manifest_path) : null;
    packages.push({
      name: pkg.name,
      version: pkg.version ?? '',
      ecosystem: 'rust',
      license: pkg.license ?? (pkg.license_file ? 'See license file' : 'UNKNOWN'),
      repository: pkg.repository ?? undefined,
      licenseText: readLicenseText(crateDir),
    });
  }
  return packages;
}

function main() {
  let npm = [];
  let rust = [];
  try { npm = collectNpm(); } catch (e) { console.warn('[licenses] npm collection failed:', e.message); }
  try { rust = collectRust(); } catch (e) { console.warn('[licenses] rust collection failed:', e.message); }

  const packages = [...npm, ...rust].sort((a, b) => {
    if (a.ecosystem !== b.ecosystem) return a.ecosystem < b.ecosystem ? -1 : 1;
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    counts: { npm: npm.length, rust: rust.length, total: packages.length },
    packages,
  };

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  // Written MINIFIED (no `null, 2` indent). This is a generated, gitignored
  // artifact that only Rust ever reads (commands/licenses.rs deserializes it
  // with serde, which is whitespace-insensitive) and that reaches the frontend
  // as an already-parsed struct over IPC — no human and no JS ever sees the
  // text, so there is nothing to keep readable.
  // Measured: 713,110 → 665,776 bytes raw (−47 KB). Post-LZMA the installer
  // only shrinks ~2-4 KB, so this is NOT an installer-size win; the payoff is
  // 47 KB less on disk after install and 47 KB less to read + parse every time
  // the About → Third-Party Licenses modal is opened.
  writeFileSync(outFile, JSON.stringify(manifest) + '\n', 'utf8');
  console.log(`[licenses] wrote ${packages.length} entries (npm: ${npm.length}, rust: ${rust.length}) → ${outFile}`);
}

try {
  main();
} catch (e) {
  // Never break the build over license generation; emit at least an empty file.
  console.warn('[licenses] generation failed, writing empty manifest:', e?.message ?? e);
  try {
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), counts: { npm: 0, rust: 0, total: 0 }, packages: [] }) + '\n', 'utf8');
  } catch { /* truly give up, but still exit 0 */ }
}
process.exit(0);
