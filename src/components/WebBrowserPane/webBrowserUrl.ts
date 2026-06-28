/** Matches an explicit `scheme://…` prefix (http/https/ftp/…). */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
/** Matches a schemeful prefix like `javascript:` / `about:` — a colon NOT
 *  followed by a digit (which would instead be a `host:port`). */
const SCHEMEFUL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:(?!\d)/;

/** True when input carries its own scheme — either `scheme://…` or a schemeful
 *  form like `javascript:` / `about:`. Such input is kept verbatim so the
 *  caller's scheme allowlist (not this normalizer) decides allow/deny. */
function hasExplicitScheme(t: string): boolean {
  return SCHEME_RE.test(t) || SCHEMEFUL_RE.test(t);
}

/** Google search prefix used when the address bar holds a search query rather
 *  than a navigable address. google.com auto-redirects to the local domain. */
const SEARCH_URL = 'https://www.google.com/search?q=';

/** Heuristic: does schemeless input name a host (→ navigate) or is it a search
 *  query (→ Google)? A host has no whitespace and either a dot (domain / IPv4),
 *  an explicit `:port`, or is `localhost`. Anything else — free text or a bare
 *  single word — is treated as a search, matching browser omnibox behavior. */
function looksLikeHost(t: string): boolean {
  if (/\s/.test(t)) return false; // whitespace ⇒ search query
  const host = t.split(/[/?#]/)[0]; // authority, before any path/query/hash
  if (!host) return false;
  if (/^localhost(:\d+)?$/i.test(host)) return true;
  if (host.includes('.')) return true; // domain or IPv4
  return /:\d+$/.test(host); // bare host:port
}

/** Normalize user input into a navigable URL. Schemeless input defaults to
 *  `http://` — most network-device admin UIs (the primary use case) are HTTP.
 *
 *  Input that carries an explicit scheme is kept as-is — either `scheme://…` or
 *  a schemeful form like `javascript:`/`about:` (colon NOT followed by a digit,
 *  which would be a `host:port` instead). This lets the caller's validation
 *  reject dangerous schemes rather than wrapping them in `http://`.
 *
 *  Use for trusted input (e.g. a saved bookmark) that is always a real address.
 *  For free-form address-bar text, use {@link resolveAddress} instead.
 */
export function normalizeUrl(input: string): string {
  const t = input.trim();
  if (!t) return '';
  if (hasExplicitScheme(t)) return t;
  return `http://${t}`;
}

/** Resolve raw address-bar text into a navigable URL. An explicit scheme is
 *  kept (the caller's allowlist decides allow/deny), a host-like address is
 *  normalized to `http://`, and free text / a bare search term becomes a
 *  Google search — so a non-URL entry lands on Google's results instead of a
 *  failed navigation.
 */
export function resolveAddress(input: string): string {
  const t = input.trim();
  if (!t) return '';
  if (hasExplicitScheme(t)) return t;
  if (looksLikeHost(t)) return `http://${t}`;
  return SEARCH_URL + encodeURIComponent(t);
}
