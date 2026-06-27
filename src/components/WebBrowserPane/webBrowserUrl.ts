/** Normalize user input into a navigable URL. Schemeless input defaults to
 *  `http://` — most network-device admin UIs (the primary use case) are HTTP.
 *
 *  Input that carries an explicit scheme is kept as-is — either `scheme://…` or
 *  a schemeful form like `javascript:`/`about:` (colon NOT followed by a digit,
 *  which would be a `host:port` instead). This lets the caller's validation
 *  reject dangerous schemes rather than wrapping them in `http://`.
 */
export function normalizeUrl(input: string): string {
  const t = input.trim();
  if (!t) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t) || /^[a-zA-Z][a-zA-Z0-9+.-]*:(?!\d)/.test(t)) {
    return t;
  }
  return `http://${t}`;
}
