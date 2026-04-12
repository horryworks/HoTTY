import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GeneralTab } from './GeneralTab';
import { useSettingsStore } from '../../stores/settingsStore';

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
    expect(screen.getByText('Storage')).toBeTruthy();
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

  it('edits scrollback value', () => {
    render(<GeneralTab />);
    const input = screen.getByText('Terminal Scrollback Buffer')
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
});
