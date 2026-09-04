// Exported for unit tests; also used internally below.
export const MAX_LOG_MESSAGE_LENGTH = 4096;

const SENSITIVE_KEYS = [
  'password',
  'passwd',
  'apikey',
  'api[_-]?key',
  'secret',
  'token',
  'client[_-]?secret',
  'private[_-]?key',
  'refresh[_-]?token',
  'access[_-]?token',
  // SNMP credentials. `auth[_-]?password` / `priv[_-]?password` need their own
  // entries because the pattern below anchors each key with \b, and there is no
  // word boundary inside `authPassword` — a bare `password` entry would not
  // match it.
  'community',
  'auth[_-]?password',
  'priv[_-]?password',
];

const KEYED_VALUE_PATTERN = new RegExp(
  // ["']?  — optional surrounding quote on the key (JSON style: "apiKey")
  // \b...\b  — exact key name with word boundaries (so `passwordless` doesn't match)
  // \s*[:=]\s*  — separator
  // value: quoted or bare
  String.raw`(["']?\b(?:${SENSITIVE_KEYS.join('|')})\b["']?\s*[:=]\s*)(?:"([^"\n]*)"|'([^'\n]*)'|([^\s,;}\)\]]+))`,
  'gi',
);

const BEARER_HEADER_PATTERN = /\b(Bearer\s+)([A-Za-z0-9._\-+/=]+)/gi;

// Network-device configuration syntax is SPACE-separated, so none of it matches
// KEYED_VALUE_PATTERN's required `:`/`=`. That is the dominant secret shape in
// this app's content — a `show running-config` the AI asked for shipped
// `password 7 08701E1D` / `snmp-server community public RO` verbatim to the
// provider. An optional encoding digit (`password 7 …`, `secret 5 …`) sits
// between the keyword and the value on IOS-like platforms.
const DEVICE_CONFIG_KEYS = [
  'password',
  'secret',
  'community',
  'key-string',
  'pre-shared-key',
  'authentication-key',
  'message-digest-key',
  'md5',
];

// Tokens that sit BETWEEN the keyword and the actual secret and must not be
// mistaken for it: a key id / encoding type digit (`password 7 …`, `secret 5 …`,
// `message-digest-key 1 …`) and a cipher name (`… message-digest-key 1 md5 KEY`,
// `authentication-key sha256 KEY`). Without the cipher alternative the pattern
// redacted `md5` and left the key that follows it in the clear.
// `[ \t]` rather than `\s` throughout: a config keyword must never reach across a
// line break and redact the first token of the NEXT line.
const DEVICE_CONFIG_PREFIX = String.raw`(?:[ \t]+\d+)?(?:[ \t]+(?:md5|sha(?:1|256|384|512)?|hmac-[^\s:=]+|cipher|encrypted|simple|clear|plain|text))?`;

const DEVICE_CONFIG_PATTERN = new RegExp(
  // (keyword)(id / cipher prefix)(whitespace) → then the value token.
  // The value may not start with `:`/`=` — that shape is the keyed rule's job and
  // has already been redacted by the time this runs.
  String.raw`\b(${DEVICE_CONFIG_KEYS.join('|')})\b(${DEVICE_CONFIG_PREFIX})[ \t]+([^\s:=]\S*)`,
  'gi',
);

// `password`/`secret` also occur in ordinary prose ("the password is wrong",
// "enter your password to continue"), where the next word is not a credential.
// Redacting those costs the model real context for no security gain, so a short
// stop-word guard skips them. Anything not on this list is still redacted — the
// guard only shrinks over-redaction, it never lets a credential-shaped token by.
const PROSE_FOLLOWERS = new Set([
  'is', 'was', 'are', 'were', 'be', 'been', 'has', 'have', 'had',
  'will', 'would', 'must', 'should', 'can', 'cannot', 'could', 'may',
  'to', 'for', 'the', 'a', 'an', 'and', 'or', 'not', 'of', 'in', 'on',
  'expired', 'incorrect', 'invalid', 'required', 'changed', 'accepted',
  'authentication', 'prompt', 'field', 'again', 'here',
]);

// PEM bodies (private keys pasted into or printed by a session) are multi-line
// and carry no key/value separator at all, so both patterns above miss them.
const PEM_BLOCK_PATTERN =
  /(-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z0-9 ]*PRIVATE KEY-----)/g;

const REDACTED = '<redacted>';

/**
 * Replace secret-looking values (password/api-key/token/… assignments and
 * `Bearer …` headers) with `<redacted>`, WITHOUT truncating. Use this on
 * content that egresses to the third-party AI provider (watched terminal output,
 * selected text, auto-exec captures) so secrets in scrollback aren't shipped
 * verbatim. Truncation is deliberately omitted — the AI needs the full context.
 */
export function redactSecrets(message: string): string {
  let result = message.replace(
    KEYED_VALUE_PATTERN,
    (_match, prefix: string, dquoted?: string, squoted?: string) => {
      if (dquoted !== undefined) return `${prefix}"${REDACTED}"`;
      if (squoted !== undefined) return `${prefix}'${REDACTED}'`;
      return `${prefix}${REDACTED}`;
    },
  );
  result = result.replace(BEARER_HEADER_PATTERN, (_m, prefix: string) => `${prefix}${REDACTED}`);
  // After the keyed rule, so `password: hunter2` is already handled and this only
  // sees the space-separated device-config form.
  result = result.replace(
    DEVICE_CONFIG_PATTERN,
    (match: string, key: string, prefix: string, value: string) => {
      // An explicit id / cipher (`password 7 …`, `… 1 md5 …`) is device syntax,
      // never prose, so the stop-word guard only applies to the bare form.
      if (!prefix && PROSE_FOLLOWERS.has(value.toLowerCase())) return match;
      return `${key}${prefix} ${REDACTED}`;
    },
  );
  result = result.replace(PEM_BLOCK_PATTERN, (_m, begin: string, end: string) => `${begin}\n${REDACTED}\n${end}`);
  return result;
}

export function redactSensitive(message: string): string {
  let result = redactSecrets(message);
  if (result.length > MAX_LOG_MESSAGE_LENGTH) {
    result = `${result.slice(0, MAX_LOG_MESSAGE_LENGTH)}...<truncated>`;
  }
  return result;
}
