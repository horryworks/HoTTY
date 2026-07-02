import { describe, it, expect } from 'vitest';
import { classifyCommand } from './commandClassifier';
import { DEFAULT_WHITELIST } from './commandLists';

// The classifier no longer carries a built-in list — callers inject the
// whitelist. Most tests use the default whitelist.
const wl = DEFAULT_WHITELIST;

describe('classifyCommand', () => {
  it('classifies simple safe commands', () => {
    expect(classifyCommand('ls -la', wl).safe).toBe(true);
    expect(classifyCommand('show version', wl).safe).toBe(true);
    expect(classifyCommand('ping 8.8.8.8', wl).safe).toBe(true);
    expect(classifyCommand('display interface', wl).safe).toBe(true);
    expect(classifyCommand('screen-length 0 temporary', wl).safe).toBe(true);
  });

  it('rejects unknown commands', () => {
    const result = classifyCommand('frobnicate /', wl);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Unknown command');
  });

  it('rejects output redirection', () => {
    const result = classifyCommand('echo hello > file.txt', wl);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('redirection');
  });

  it('rejects command chaining with &&', () => {
    const result = classifyCommand('ls && rm file', wl);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('chaining');
  });

  it('rejects sudo', () => {
    const result = classifyCommand('sudo apt install vim', wl);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('privilege escalation');
  });

  it('defers runner/interpreter commands to AI/manual review (no whitelist fast-path)', () => {
    // git/find/sed/awk/env are whitelisted read tools, but each has a shell-exec
    // or file-write escape hatch, so they must NOT auto-exec via the whitelist —
    // they fall through to the AI verdict (hybrid) or a manual ask (static).
    for (const cmd of [
      'git status',
      'git push origin main',
      'find . -name x',
      'awk \'{print $1}\' file',
      'sed s/a/b/ file',
      'env MYVAR=1 printenv',
      'xargs echo',
      'python3 script.py',
      'bash -c id',
    ]) {
      const r = classifyCommand(cmd, wl);
      expect(r.safe, cmd).toBe(false);
    }
  });

  it('blocks classic runner-based classifier bypasses', () => {
    // The confirmed auto-exec bypass vectors from the audit.
    expect(classifyCommand('env poweroff', wl).safe).toBe(false);
    expect(classifyCommand('env sh -c id', wl).safe).toBe(false);
    expect(classifyCommand("awk 'BEGIN{system(\"id\")}'", wl).safe).toBe(false);
    expect(classifyCommand('sed --in-place s/a/b/ /etc/passwd', wl).safe).toBe(false);
    expect(classifyCommand('find . -execdir rm -rf {} +', wl).safe).toBe(false);
  });

  it('rejects a lone & (backgrounding / chaining)', () => {
    // `ls` is whitelisted, but `ls & poweroff` must not auto-exec via the base
    // command — the lone `&` is a structural danger, distinct from `&&`.
    const result = classifyCommand('ls & poweroff', wl);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('&');
    // `&&` still classifies (and is reported as chaining), not as a lone `&`.
    expect(classifyCommand('ls && rm file', wl).safe).toBe(false);
  });

  it('allows piped commands with safe commands', () => {
    expect(classifyCommand('show running-config | include interface', wl).safe).toBe(true);
    expect(classifyCommand('ls -la | grep test', wl).safe).toBe(true);
  });

  it('rejects empty commands', () => {
    expect(classifyCommand('', wl).safe).toBe(false);
  });

  it('classifies multi-line commands', () => {
    expect(classifyCommand('show version\nshow interfaces', wl).safe).toBe(true);
    expect(classifyCommand('show version\nrm -rf /', wl).safe).toBe(false);
  });

  it('treats an unknown base command as unsafe when not whitelisted', () => {
    // `docker` is NOT in the default whitelist → falls through (AI/ask layer decides).
    expect(classifyCommand('docker ps', wl).safe).toBe(false);
  });

  it('allows a single-token whitelist entry (base-command match)', () => {
    const result = classifyCommand('mycli status', ['mycli']);
    expect(result.safe).toBe(true);
  });

  it('allows a whitelist phrase only as an anchored prefix (not any substring)', () => {
    // Phrase entry: matched only when it is a prefix of the command segment.
    expect(classifyCommand('kubectl get pods', ['kubectl get']).safe).toBe(true);
    expect(classifyCommand('kubectl delete pod x', ['kubectl get']).safe).toBe(false);
    // A phrase appearing as a non-prefix substring must NOT be whitelisted —
    // guards against auto-exec smuggling via an unanchored substring match.
    expect(classifyCommand('foo kubectl get', ['kubectl get']).safe).toBe(false);
    // A token boundary is required: a longer word sharing the prefix is rejected.
    expect(classifyCommand('kubectl getx', ['kubectl get']).safe).toBe(false);
  });

  it('rejects find with -exec', () => {
    // The escaped semicolon matches the chaining pattern first
    expect(classifyCommand('find . -exec rm {} \\;', wl).safe).toBe(false);
    // Without a semicolon, `find` is still blocked — it is a runner command, so
    // it never takes the whitelist fast path regardless of the flag used.
    expect(classifyCommand('find . -exec rm {} +', wl).safe).toBe(false);
  });

  it('rejects sed in-place edits', () => {
    // `sed` is a runner (it has an `e`/`w` exec/write escape), so any sed invocation
    // is deferred rather than auto-executed via the whitelist.
    expect(classifyCommand('sed -i s/foo/bar/g file.txt', wl).safe).toBe(false);
  });

  it('rejects command substitution', () => {
    expect(classifyCommand('echo $(whoami)', wl).safe).toBe(false);
  });
});
