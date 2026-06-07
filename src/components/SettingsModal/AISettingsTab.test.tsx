import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AISettingsTab } from './AISettingsTab';
import { useSettingsStore } from '../../stores/settingsStore';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    aiSetProvider: vi.fn().mockResolvedValue(undefined),
    aiAuthStatus: vi.fn().mockResolvedValue(false),
    aiAuthLogout: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('AISettingsTab', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it('renders section headers', () => {
    render(<AISettingsTab />);
    expect(screen.getByText('Provider')).toBeTruthy();
    expect(screen.getByText('Personas')).toBeTruthy();
    expect(screen.getByText('Command Execution')).toBeTruthy();
  });

  it('renders provider select with default value', () => {
    render(<AISettingsTab />);
    const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    expect(select.value).toBe('gemini');
  });

  it('renders default persona tab', () => {
    render(<AISettingsTab />);
    expect(screen.getByText('Network Expert')).toBeTruthy();
  });

  it('updates persona name', () => {
    render(<AISettingsTab />);
    const nameInput = screen.getByPlaceholderText('Display Name');
    fireEvent.change(nameInput, { target: { value: 'My Persona' } });
    expect(useSettingsStore.getState().aiPersonas[0].label).toBe('My Persona');
  });

  it('adds a new persona', () => {
    render(<AISettingsTab />);
    const addBtn = screen.getByText('+');
    fireEvent.click(addBtn);
    expect(useSettingsStore.getState().aiPersonas).toHaveLength(7);
  });

  it('adds a new command to active persona', () => {
    render(<AISettingsTab />);
    const addCmdBtn = screen.getByText('+ Add Command');
    fireEvent.click(addCmdBtn);
    expect(useSettingsStore.getState().aiPersonas[0].askAiCommands).toHaveLength(7);
  });

  it('resets commands to defaults', () => {
    // Add a command first
    const store = useSettingsStore.getState();
    const personas = [...store.aiPersonas];
    personas[0] = { ...personas[0], askAiCommands: [] };
    store.update('aiPersonas', personas);

    render(<AISettingsTab />);
    const resetBtn = screen.getByText('Reset Commands');
    fireEvent.click(resetBtn);
    expect(useSettingsStore.getState().aiPersonas[0].askAiCommands).toHaveLength(4);
  });

  it('does not render execution mode select (moved to AI Chat pane)', () => {
    render(<AISettingsTab />);
    expect(screen.queryByText('Execution Mode')).toBeNull();
    expect(screen.queryByText('Max Consecutive Auto-Executions')).toBeNull();
  });

  it('shows the whitelist and blacklist inputs', () => {
    render(<AISettingsTab />);
    expect(screen.getByPlaceholderText('e.g., docker, kubectl get')).toBeTruthy();
    expect(screen.getByPlaceholderText('e.g., rm -rf, git push')).toBeTruthy();
  });

  it('adds a whitelist entry', () => {
    render(<AISettingsTab />);
    const input = screen.getByPlaceholderText('e.g., docker, kubectl get');
    fireEvent.change(input, { target: { value: 'mytool' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useSettingsStore.getState().whitelistCommands).toContain('mytool');
  });

  it('adds a blacklist entry', () => {
    render(<AISettingsTab />);
    const input = screen.getByPlaceholderText('e.g., rm -rf, git push');
    fireEvent.change(input, { target: { value: 'danger-cmd' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useSettingsStore.getState().blacklistCommands).toContain('danger-cmd');
  });

  it('resets the whitelist to defaults', () => {
    useSettingsStore.getState().update('whitelistCommands', ['only-this']);
    render(<AISettingsTab />);
    fireEvent.click(screen.getAllByTitle(/Reset the whitelist/i)[0]);
    expect(useSettingsStore.getState().whitelistCommands).toContain('ls');
    expect(useSettingsStore.getState().whitelistCommands).not.toContain('only-this');
  });

  it('shows authentication status', () => {
    render(<AISettingsTab />);
    expect(screen.getByText('Not Authenticated')).toBeTruthy();
  });

  it('renders device response timeout input with default value', () => {
    render(<AISettingsTab />);
    expect(screen.getByText('Device Response Timeout (seconds)')).toBeTruthy();
    const input = screen.getByText('Device Response Timeout (seconds)')
      .closest('.settings-group')!
      .querySelector('input[type="number"]') as HTMLInputElement;
    expect(input.value).toBe('10');
  });

  it('updates device response timeout', () => {
    render(<AISettingsTab />);
    const input = screen.getByText('Device Response Timeout (seconds)')
      .closest('.settings-group')!
      .querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '60' } });
    expect(useSettingsStore.getState().aiCommandIdleTimeoutSecs).toBe(60);
  });

  it('accepts 0 as device response timeout (disabled)', () => {
    render(<AISettingsTab />);
    const input = screen.getByText('Device Response Timeout (seconds)')
      .closest('.settings-group')!
      .querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    expect(useSettingsStore.getState().aiCommandIdleTimeoutSecs).toBe(0);
  });

  it('clamps invalid device response timeout to 0', () => {
    render(<AISettingsTab />);
    const input = screen.getByText('Device Response Timeout (seconds)')
      .closest('.settings-group')!
      .querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-5' } });
    expect(useSettingsStore.getState().aiCommandIdleTimeoutSecs).toBe(0);
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(useSettingsStore.getState().aiCommandIdleTimeoutSecs).toBe(0);
  });
});
