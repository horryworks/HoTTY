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

const REDACTED = '<redacted>';

export function redactSensitive(message: string): string {
  let result = message.replace(
    KEYED_VALUE_PATTERN,
    (_match, prefix: string, dquoted?: string, squoted?: string) => {
      if (dquoted !== undefined) return `${prefix}"${REDACTED}"`;
      if (squoted !== undefined) return `${prefix}'${REDACTED}'`;
      return `${prefix}${REDACTED}`;
    },
  );
  result = result.replace(BEARER_HEADER_PATTERN, (_m, prefix: string) => `${prefix}${REDACTED}`);

  if (result.length > MAX_LOG_MESSAGE_LENGTH) {
    result = `${result.slice(0, MAX_LOG_MESSAGE_LENGTH)}...<truncated>`;
  }
  return result;
}
