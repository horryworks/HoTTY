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
    expect(classifyCommand('git status', wl).safe).toBe(true);
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

  it('rejects dangerous git subcommands', () => {
    const result = classifyCommand('git push origin main', wl);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('git write operation');
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
    const result1 = classifyCommand('find . -exec rm {} \\;', wl);
    expect(result1.safe).toBe(false);

    // Without semicolon, -exec flag rule catches it
    const result2 = classifyCommand('find . -exec rm {} +', wl);
    expect(result2.safe).toBe(false);
    expect(result2.reason).toContain('find with -exec');
  });

  it('rejects sed with -i', () => {
    const result = classifyCommand('sed -i s/foo/bar/g file.txt', wl);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('in-place edit');
  });

  it('rejects command substitution', () => {
    expect(classifyCommand('echo $(whoami)', wl).safe).toBe(false);
  });
});
