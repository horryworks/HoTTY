import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, SETTINGS_DEFAULTS, DEFAULT_PROMPT_PATTERNS } from './settingsStore';

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    localStorage.clear();
  });

  it('starts with defaults', () => {
    const s = useSettingsStore.getState();
    expect(s.globalEncoding).toBe(SETTINGS_DEFAULTS.globalEncoding);
    expect(s.fontSize).toBe(SETTINGS_DEFAULTS.fontSize);
    expect(s.sshKeepAliveInterval).toBe(SETTINGS_DEFAULTS.sshKeepAliveInterval);
  });

  it('update mutates a single key', () => {
    useSettingsStore.getState().update('fontSize', 20);
    expect(useSettingsStore.getState().fontSize).toBe(20);
  });

  it('reset restores defaults', () => {
    useSettingsStore.getState().update('fontSize', 99);
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().fontSize).toBe(SETTINGS_DEFAULTS.fontSize);
  });

  it('defaults to the dark theme', () => {
    expect(useSettingsStore.getState().theme).toBe('dark');
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
});
