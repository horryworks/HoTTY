import { describe, it, expect } from 'vitest';
import { classifyCommand } from './commandClassifier';

describe('classifyCommand', () => {
  it('classifies simple safe commands', () => {
    expect(classifyCommand('ls -la').safe).toBe(true);
    expect(classifyCommand('show version').safe).toBe(true);
    expect(classifyCommand('ping 8.8.8.8').safe).toBe(true);
    expect(classifyCommand('git status').safe).toBe(true);
    expect(classifyCommand('display interface').safe).toBe(true);
    expect(classifyCommand('screen-length 0 temporary').safe).toBe(true);
  });

  it('rejects unknown commands', () => {
    const result = classifyCommand('rm -rf /');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Unknown command');
  });

  it('rejects output redirection', () => {
    const result = classifyCommand('echo hello > file.txt');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('redirection');
  });

  it('rejects command chaining with &&', () => {
    const result = classifyCommand('ls && rm file');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('chaining');
  });

  it('rejects sudo', () => {
    const result = classifyCommand('sudo apt install vim');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('privilege escalation');
  });

  it('rejects dangerous git subcommands', () => {
    const result = classifyCommand('git push origin main');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('git write operation');
  });

  it('allows piped commands with safe commands', () => {
    expect(classifyCommand('show running-config | include interface').safe).toBe(true);
    expect(classifyCommand('ls -la | grep test').safe).toBe(true);
  });

  it('rejects empty commands', () => {
    expect(classifyCommand('').safe).toBe(false);
  });

  it('classifies multi-line commands', () => {
    expect(classifyCommand('show version\nshow interfaces').safe).toBe(true);
    expect(classifyCommand('show version\nrm -rf /').safe).toBe(false);
  });

  it('allows custom safe commands', () => {
    const result = classifyCommand('mycli status', ['mycli']);
    expect(result.safe).toBe(true);
  });

  it('rejects find with -exec', () => {
    // The escaped semicolon matches the chaining pattern first
    const result1 = classifyCommand('find . -exec rm {} \\;');
    expect(result1.safe).toBe(false);

    // Without semicolon, -exec flag rule catches it
    const result2 = classifyCommand('find . -exec rm {} +');
    expect(result2.safe).toBe(false);
    expect(result2.reason).toContain('find with -exec');
  });

  it('rejects sed with -i', () => {
    const result = classifyCommand('sed -i s/foo/bar/g file.txt');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('in-place edit');
  });

  it('rejects command substitution', () => {
    expect(classifyCommand('echo $(whoami)').safe).toBe(false);
  });
});
