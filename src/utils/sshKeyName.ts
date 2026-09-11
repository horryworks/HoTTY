/**
 * Client-side mirror of the Rust `validate_key_name` in
 * `src-tauri/src/services/ssh_keys.rs`.
 *
 * The backend is the one that actually enforces this — it has to, because the
 * renderer can be bypassed. This copy exists so the generate form can say what
 * is wrong while the user is still typing, instead of letting them press
 * Generate and get a round-trip error.
 *
 * Both sides are covered by the same table of cases, so a change to one that is
 * not mirrored in the other shows up as a failing test rather than as a form
 * that accepts a name the backend then refuses.
 */

/** Long enough for `id_ed25519_some-host-name`. Matches `MAX_KEY_NAME_LEN`. */
export const MAX_SSH_KEY_NAME_LENGTH = 64;

/** Matches `MAX_COMMENT_LEN`. */
export const MAX_SSH_KEY_COMMENT_LENGTH = 128;

/**
 * Windows refuses these as file names whatever the extension follows, and a
 * create attempt on one opens the device instead of failing cleanly.
 */
const RESERVED_DEVICE_STEMS = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/** Letters, digits, dot, underscore, hyphen. Separators fall outside it. */
const ALLOWED_CHARACTERS = /^[A-Za-z0-9._-]+$/;

/**
 * Why a name was refused. These are i18n key suffixes, looked up under
 * `settings.sshKeys.nameError.*`.
 */
export type SshKeyNameError =
  | 'empty'
  | 'tooLong'
  | 'invalidCharacters'
  | 'startsWithDot'
  | 'endsWithDot'
  | 'isPublicKey'
  | 'reservedDevice';

/** Null when the name is acceptable. */
export function validateSshKeyName(name: string): SshKeyNameError | null {
  if (name.length === 0) return 'empty';
  if (name.length > MAX_SSH_KEY_NAME_LENGTH) return 'tooLong';
  if (!ALLOWED_CHARACTERS.test(name)) return 'invalidCharacters';
  if (name.startsWith('.')) return 'startsWithDot';
  // Windows silently strips a trailing dot, so `id_x.` and `id_x` would be one
  // file wearing two names.
  if (name.endsWith('.')) return 'endsWithDot';
  if (name.includes('..')) return 'invalidCharacters';

  const lower = name.toLowerCase();
  // The public-key name is derived, never supplied.
  if (lower.endsWith('.pub')) return 'isPublicKey';
  if (RESERVED_DEVICE_STEMS.has(lower.split('.')[0])) return 'reservedDevice';

  return null;
}

/** Why a comment was refused. Suffixes under `settings.sshKeys.commentError.*`. */
export type SshKeyCommentError = 'tooLong' | 'hasLineBreak';

/**
 * A comment ends up on the single line the user pastes into `authorized_keys`,
 * so a line break in it would split that line and turn the tail into silent
 * garbage on the server.
 */
export function validateSshKeyComment(comment: string): SshKeyCommentError | null {
  if (comment.length > MAX_SSH_KEY_COMMENT_LENGTH) return 'tooLong';
  // Checked by code point rather than with a regex class. The class would have
  // to spell out control characters literally, which makes the source file
  // non-text for every tool that reads it.
  for (let i = 0; i < comment.length; i += 1) {
    const code = comment.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return 'hasLineBreak';
  }
  return null;
}

/**
 * A default key name for a host, e.g. `router-01_ed25519`.
 *
 * Deliberately not `id_ed25519`: offering OpenSSH's own default name as a
 * default would aim every new user at the one file another tool is most likely
 * to have already put there.
 */
export function suggestSshKeyName(algorithm: string, host?: string): string {
  const suffix = algorithm.startsWith('rsa')
    ? 'rsa'
    : algorithm.startsWith('ecdsa')
      ? 'ecdsa'
      : 'ed25519';
  const stem = host
    ? host
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[.-]+|[.-]+$/g, '')
        .slice(0, 32)
    : '';
  const base = stem ? `${stem}_${suffix}` : `id_${suffix}_hotty`;
  // A sanitized host could still land on a reserved name or an empty stem.
  return validateSshKeyName(base) === null ? base : `id_${suffix}_hotty`;
}

/**
 * `base`, or `base-2`, `base-3`… until it does not collide with `taken`.
 *
 * Cosmetic only — the backend refuses to overwrite regardless. This just means
 * the form opens with a name that will work rather than one that will not.
 */
export function uniqueSshKeyName(base: string, taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate) && validateSshKeyName(candidate) === null) return candidate;
  }
  return base;
}
