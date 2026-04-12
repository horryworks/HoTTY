import { describe, it, expect } from 'vitest';
import { buildExecutionRules } from './aiPrompts';

describe('buildExecutionRules', () => {
  it('returns a non-empty string', () => {
    const rules = buildExecutionRules();
    expect(rules).toBeTruthy();
    expect(rules.length).toBeGreaterThan(0);
  });

  it('contains execute block instruction', () => {
    const rules = buildExecutionRules();
    expect(rules).toContain('```execute');
  });

  it('forbids bash code blocks', () => {
    const rules = buildExecutionRules();
    expect(rules).toContain('```bash');
  });

  it('includes the stop rule', () => {
    const rules = buildExecutionRules();
    expect(rules).toContain('STOP');
  });

  it('includes the single block rule', () => {
    const rules = buildExecutionRules();
    expect(rules).toContain('EXACTLY ONE');
  });

  it('forbids chaining commands', () => {
    const rules = buildExecutionRules();
    expect(rules).toContain('&&');
  });
});
