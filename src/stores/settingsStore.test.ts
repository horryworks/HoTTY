import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, DEFAULT_PROMPT_PATTERNS } from './settingsStore';

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    localStorage.clear();
  });

  it('starts with defaults', () => {
    const s = useSettingsStore.getState();
    expect(s.globalEncoding).toBe('utf8');
    expect(s.fontSize).toBe(14);
    expect(s.sshKeepAliveInterval).toBe(10);
  });

  it('defaults SSH and Telnet connect timeouts to 5 seconds', () => {
    const s = useSettingsStore.getState();
    expect(s.sshConnectTimeoutSecs).toBe(5);
    expect(s.telnetConnectTimeoutSecs).toBe(5);
  });

  it('defaults the AI data-consent gate to not-accepted', () => {
    expect(useSettingsStore.getState().aiDataConsentAccepted).toBe(false);
  });

  it("defaults fixedTerminalSizeMode to 'auto' and updates it", () => {
    // 'auto' is the recommended default: it pins only the device families that
    // actually latch their width, leaving normal hosts dynamic.
    expect(useSettingsStore.getState().fixedTerminalSizeMode).toBe('auto');
    useSettingsStore.getState().update('fixedTerminalSizeMode', 'on');
    expect(useSettingsStore.getState().fixedTerminalSizeMode).toBe('on');
    useSettingsStore.getState().update('fixedTerminalSizeMode', 'off');
    expect(useSettingsStore.getState().fixedTerminalSizeMode).toBe('off');
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().fixedTerminalSizeMode).toBe('auto');
  });

  it('records AI data-consent acceptance and clears it on reset', () => {
    useSettingsStore.getState().update('aiDataConsentAccepted', true);
    expect(useSettingsStore.getState().aiDataConsentAccepted).toBe(true);
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().aiDataConsentAccepted).toBe(false);
  });

  it('update mutates a single key', () => {
    useSettingsStore.getState().update('fontSize', 20);
    expect(useSettingsStore.getState().fontSize).toBe(20);
  });

  it('reset restores defaults', () => {
    useSettingsStore.getState().update('fontSize', 99);
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().fontSize).toBe(14);
  });

  it('defaults to the dark theme', () => {
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('defaults the UI language to English', () => {
    expect(useSettingsStore.getState().language).toBe('en');
  });

  it('updates the language field', () => {
    useSettingsStore.getState().update('language', 'ja');
    expect(useSettingsStore.getState().language).toBe('ja');
  });

  it("defaults the AI response language to 'Auto' (follows the UI language)", () => {
    expect(useSettingsStore.getState().aiResponseLanguage).toBe('Auto');
  });

  it('updates the AI response language and restores Auto on reset', () => {
    useSettingsStore.getState().update('aiResponseLanguage', 'Japanese');
    expect(useSettingsStore.getState().aiResponseLanguage).toBe('Japanese');
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().aiResponseLanguage).toBe('Auto');
  });

  it('defaults pane background to color mode with no image', () => {
    const s = useSettingsStore.getState();
    expect(s.paneBackgroundMode).toBe('color');
    expect(s.paneBackgroundImage).toBe('');
  });

  it('updates pane background mode and image', () => {
    useSettingsStore.getState().update('paneBackgroundMode', 'image');
    useSettingsStore.getState().update('paneBackgroundImage', 'http://asset.localhost/foo.png');
    expect(useSettingsStore.getState().paneBackgroundMode).toBe('image');
    expect(useSettingsStore.getState().paneBackgroundImage).toBe('http://asset.localhost/foo.png');
  });

  it('updates the theme field', () => {
    useSettingsStore.getState().update('theme', 'light');
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('defaults prompt highlight to enabled with default patterns', () => {
    const s = useSettingsStore.getState();
    expect(s.enablePromptHighlight).toBe(true);
    expect(s.promptHighlightColor).toBe('');
    expect(s.promptPatterns).toEqual(DEFAULT_PROMPT_PATTERNS);
  });

  it('updates prompt highlight settings', () => {
    useSettingsStore.getState().update('enablePromptHighlight', false);
    expect(useSettingsStore.getState().enablePromptHighlight).toBe(false);

    useSettingsStore.getState().update('promptHighlightColor', '#ff0000');
    expect(useSettingsStore.getState().promptHighlightColor).toBe('#ff0000');

    const newPatterns = [{ id: 'test', name: 'Test', pattern: '^test' }];
    useSettingsStore.getState().update('promptPatterns', newPatterns);
    expect(useSettingsStore.getState().promptPatterns).toEqual(newPatterns);
  });

  it('defaults logging to disabled with empty path', () => {
    const s = useSettingsStore.getState();
    expect(s.loggingEnabled).toBe(false);
    expect(s.loggingPath).toBe('');
  });

  it('updates logging settings', () => {
    useSettingsStore.getState().update('loggingEnabled', true);
    expect(useSettingsStore.getState().loggingEnabled).toBe(true);

    useSettingsStore.getState().update('loggingPath', 'C:\\logs');
    expect(useSettingsStore.getState().loggingPath).toBe('C:\\logs');
  });

  it('defaults AI command idle timeout to 10 seconds', () => {
    expect(useSettingsStore.getState().aiCommandIdleTimeoutSecs).toBe(10);
  });

  it('updates AI command idle timeout', () => {
    useSettingsStore.getState().update('aiCommandIdleTimeoutSecs', 60);
    expect(useSettingsStore.getState().aiCommandIdleTimeoutSecs).toBe(60);

    useSettingsStore.getState().update('aiCommandIdleTimeoutSecs', 0);
    expect(useSettingsStore.getState().aiCommandIdleTimeoutSecs).toBe(0);
  });

  it('defaults the GCP IAP username override to blank (auto-detect)', () => {
    expect(useSettingsStore.getState().gcpIapUsername).toBe('');
  });

  it('updates the GCP IAP username override', () => {
    useSettingsStore.getState().update('gcpIapUsername', 'alice');
    expect(useSettingsStore.getState().gcpIapUsername).toBe('alice');

    useSettingsStore.getState().update('gcpIapUsername', '');
    expect(useSettingsStore.getState().gcpIapUsername).toBe('');
  });
});
