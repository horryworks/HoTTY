import { describe, it, expect } from 'vitest';
import {
  buildExecutionRules,
  languageDirective,
  languageSwitchNotice,
  resolveAiLanguage,
  AI_LANGUAGE_BY_UI_LANGUAGE,
  AUTO_LANGUAGE,
} from './aiPrompts';

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
  it('emits a directive for English too', () => {
    // Regression: English used to return '' ("the model default"), so selecting
    // English mid-conversation sent NO instruction at all and the model kept
    // answering in the language already in the replayed history.
    const directive = languageDirective('English');
    expect(directive).not.toBe('');
    expect(directive).toContain('English');
  });

  it('returns empty for Auto so it never leaks as a literal language', () => {
    // Regression guard: 'Auto' must NOT produce "answer in Auto" — callers run
    // the value through resolveAiLanguage first.
    expect(languageDirective(AUTO_LANGUAGE)).toBe('');
    expect(languageDirective('Auto')).toBe('');
  });

  it('returns empty for null/undefined/empty input', () => {
    expect(languageDirective(null)).toBe('');
    expect(languageDirective(undefined)).toBe('');
    expect(languageDirective('')).toBe('');
  });

  it('names the language and orders an override of the earlier turns', () => {
    const directive = languageDirective('Japanese');
    expect(directive).toContain('Japanese');
    expect(directive).toContain('overrides');
    expect(directive).toContain('switch to Japanese');
  });

  it('exempts execute blocks and paths from translation', () => {
    // An "answer in Japanese" instruction must never translate a command the
    // auto-exec loop then runs on a real device.
    const directive = languageDirective('Japanese');
    expect(directive).toContain('Do NOT translate');
    expect(directive).toContain('```execute');
    expect(directive).toContain('file paths');
  });
});

describe('resolveAiLanguage', () => {
  it('lets an explicit choice win over the UI language', () => {
    expect(resolveAiLanguage('French', 'ja')).toBe('French');
    expect(resolveAiLanguage('German', 'ja')).toBe('German');
  });

  it('follows the UI language for Auto', () => {
    expect(resolveAiLanguage(AUTO_LANGUAGE, 'ja')).toBe('Japanese');
    expect(resolveAiLanguage(AUTO_LANGUAGE, 'en')).toBe('English');
  });

  it('disambiguates the two Chinese UI languages', () => {
    expect(resolveAiLanguage(AUTO_LANGUAGE, 'zh-CN')).toBe('Chinese (Simplified)');
    expect(resolveAiLanguage(AUTO_LANGUAGE, 'zh-TW')).toBe('Chinese (Traditional)');
  });

  it('treats an empty/missing selection like Auto', () => {
    expect(resolveAiLanguage(undefined, 'ko')).toBe('Korean');
    expect(resolveAiLanguage(null, 'ko')).toBe('Korean');
    expect(resolveAiLanguage('', 'ko')).toBe('Korean');
  });

  it('falls back to English for an unknown/absent UI language', () => {
    // Must never resolve to nothing — an empty directive is what let the
    // conversation history silently decide the language.
    expect(resolveAiLanguage(AUTO_LANGUAGE, 'de')).toBe('English');
    expect(resolveAiLanguage(AUTO_LANGUAGE, undefined)).toBe('English');
  });

  it('maps exactly the supported UI languages', () => {
    expect(Object.keys(AI_LANGUAGE_BY_UI_LANGUAGE).sort()).toEqual(
      ['en', 'es', 'fr', 'ja', 'ko', 'ru', 'zh-CN', 'zh-TW'],
    );
  });
});

describe('languageSwitchNotice', () => {
  it('names the language and separates itself from the message', () => {
    const notice = languageSwitchNotice('Japanese');
    expect(notice.startsWith('\n\n')).toBe(true);
    expect(notice).toContain('[Language switched]');
    expect(notice).toContain('Japanese');
  });
});
