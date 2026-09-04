import { describe, it, expect } from 'vitest';
import {
  buildExecutionRules,
  buildConnectCapabilityBlock,
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

describe('buildExecutionRules (connect fence)', () => {
  it('admits exactly one connect block as the alternative to execute, never both', () => {
    const rules = buildExecutionRules();
    expect(rules).toContain('```connect');
    expect(rules).toContain('NEVER both');
    expect(rules).toContain('[Terminal Connections]');
  });
});

describe('buildConnectCapabilityBlock', () => {
  const base = {
    policy: 'local-auto' as const,
    terminals: [
      { alias: 'core-01', displayName: 'core-01', live: true, host: '192.0.2.1', protocol: 'ssh', aiOpened: false },
      { alias: 'sw-01', displayName: 'sw-01', live: false, host: '192.0.2.10', protocol: 'ssh', aiOpened: true },
    ],
    localShellType: 'powershell' as const,
    remainingSlots: 3,
    idleMinutes: 10,
  };

  it('returns nothing when the policy is off', () => {
    expect(buildConnectCapabilityBlock({ ...base, policy: 'off' })).toBe('');
  });

  it('teaches the fence grammar and the envelope contract', () => {
    const block = buildConnectCapabilityBlock(base);
    expect(block).toContain('[Terminal Connections]');
    expect(block).toContain('```connect');
    expect(block).toContain('type: local | ssh | telnet');
    expect(block).toContain('Terminal Connected (<key> as <alias>)');
    expect(block).toContain('Connection Failed / Declined / Refused');
    expect(block).toContain('show cdp neighbors detail');
  });

  it('lists watched terminals with host, AI-opened and disconnected flags even for one terminal', () => {
    const block = buildConnectCapabilityBlock({ ...base, terminals: [base.terminals[0]] });
    expect(block).toContain('core-01 (ssh 192.0.2.1)');
    const both = buildConnectCapabilityBlock(base);
    expect(both).toContain('sw-01 (ssh 192.0.2.10, AI-opened, disconnected)');
  });

  it('names the shell, the remaining slots and the idle timeout', () => {
    const block = buildConnectCapabilityBlock(base);
    expect(block).toContain('PowerShell');
    expect(block).toContain('3 more terminal(s)');
    expect(block).toContain('10 minutes');
  });

  it('points at an already-open PC shell instead of offering a new one', () => {
    const block = buildConnectCapabilityBlock({ ...base, localShellOpen: 'powershell-ai' });
    expect(block).toContain('ALREADY open as alias "powershell-ai"');
    expect(block).toContain('target=powershell-ai');
  });

  it('forbids further requests once the cap is reached and omits the idle note at 0', () => {
    const block = buildConnectCapabilityBlock({ ...base, remainingSlots: 0, idleMinutes: 0 });
    expect(block).toContain('limit of AI-opened terminals is reached');
    expect(block).not.toContain('closed automatically');
  });
});
