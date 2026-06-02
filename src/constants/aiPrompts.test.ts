import { describe, it, expect } from 'vitest';
import { buildExecutionRules, languageDirective, AUTO_LANGUAGE } from './aiPrompts';

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

describe('languageDirective', () => {
  it('returns empty for English (the model default)', () => {
    expect(languageDirective('English')).toBe('');
  });

  it('returns empty for Auto so it never leaks as a literal language', () => {
    // Regression guard: 'Auto' must NOT produce "You MUST answer in Auto."
    expect(languageDirective(AUTO_LANGUAGE)).toBe('');
    expect(languageDirective('Auto')).toBe('');
  });

  it('returns empty for null/undefined/empty input', () => {
    expect(languageDirective(null)).toBe('');
    expect(languageDirective(undefined)).toBe('');
    expect(languageDirective('')).toBe('');
  });

  it('asks the model to answer in any other language', () => {
    expect(languageDirective('Japanese')).toBe(' You MUST answer in Japanese.');
    expect(languageDirective('French')).toBe(' You MUST answer in French.');
  });
});
