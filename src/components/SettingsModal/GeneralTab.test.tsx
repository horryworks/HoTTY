import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GeneralTab } from './GeneralTab';
import { useSettingsStore } from '../../stores/settingsStore';
import { SUPPORTED_LANGUAGES } from '../../i18n';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    selectFolder: vi.fn().mockResolvedValue(null),
    openDebugLogFolder: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('GeneralTab', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it('renders section headers', () => {
    render(<GeneralTab />);
    expect(screen.getByText('Logging')).toBeTruthy();
    expect(screen.getByText('Terminal')).toBeTruthy();
    expect(screen.getByText('Input')).toBeTruthy();
    expect(screen.getByText('Diagnostics')).toBeTruthy();
  });

  it('toggles logging enabled', () => {
    render(<GeneralTab />);
    const checkbox = screen.getByText('Enable Logging').querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(useSettingsStore.getState().loggingEnabled).toBe(true);
  });

  it('shows log path input when logging is enabled', () => {
    useSettingsStore.getState().update('loggingEnabled', true);
    render(<GeneralTab />);
    expect(screen.getByPlaceholderText('Select a folder or type path...')).toBeTruthy();
  });

  it('saves the log folder when the field is left, not on every keystroke', () => {
    useSettingsStore.getState().update('loggingEnabled', true);
    render(<GeneralTab />);
    const input = screen.getByPlaceholderText('Select a folder or type path...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'D:/l' } });
    fireEvent.change(input, { target: { value: 'D:/logs' } });
    expect(input.value).toBe('D:/logs');
    expect(useSettingsStore.getState().loggingPath).toBe('');
    fireEvent.blur(input);
    expect(useSettingsStore.getState().loggingPath).toBe('D:/logs');
  });

  it('saves the log folder on Enter, and on closing while still typing', () => {
    useSettingsStore.getState().update('loggingEnabled', true);
    const first = render(<GeneralTab />);
    let input = screen.getByPlaceholderText('Select a folder or type path...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'D:/a' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useSettingsStore.getState().loggingPath).toBe('D:/a');

    input = screen.getByPlaceholderText('Select a folder or type path...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'D:/b' } });
    first.unmount();
    expect(useSettingsStore.getState().loggingPath).toBe('D:/b');
  });

  it('edits scrollback value', () => {
    render(<GeneralTab />);
    const input = screen.getByText('Scrollback Buffer')
      .closest('.settings-group')!.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5000' } });
    expect(useSettingsStore.getState().scrollback).toBe(5000);
  });

  it('toggles line wrap', () => {
    render(<GeneralTab />);
    const checkbox = screen.getByText('Enable line wrap').querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(useSettingsStore.getState().lineWrapEnabled).toBe(false);
  });

  it('toggles backspace sends DEL', () => {
    render(<GeneralTab />);
    const checkbox = screen.getByText(/Backspace sends DEL/).querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(useSettingsStore.getState().backspaceSendsDel).toBe(true);
  });

  it('toggles right-click to paste', () => {
    render(<GeneralTab />);
    const checkbox = screen.getByText('Right-click to paste').querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(useSettingsStore.getState().rightClickPaste).toBe(false);
  });

  it('renders debug log folder button', () => {
    render(<GeneralTab />);
    expect(screen.getByText('Open Debug Log Folder')).toBeTruthy();
  });

  it('renders the language selector with all supported languages', () => {
    render(<GeneralTab />);
    const select = screen.getByDisplayValue('English') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(SUPPORTED_LANGUAGES.map((l) => l.id));
    expect(values).toContain('en');
    expect(values).toContain('ja');
  });

  it('switches the UI language via the selector', () => {
    render(<GeneralTab />);
    const select = screen.getByDisplayValue('English') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'ja' } });
    expect(useSettingsStore.getState().language).toBe('ja');
  });
});
