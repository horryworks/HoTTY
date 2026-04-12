import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, SETTINGS_DEFAULTS } from './settingsStore';

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

  it('updates the theme field', () => {
    useSettingsStore.getState().update('theme', 'light');
    expect(useSettingsStore.getState().theme).toBe('light');
  });
});
