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

  it('always shows custom safe commands input regardless of execution mode', () => {
    // Default mode is 'ask-before-execute' — input should still be visible.
    render(<AISettingsTab />);
    expect(screen.getByPlaceholderText('Command name (e.g., mycheck)')).toBeTruthy();
  });

  it('adds a custom safe command', () => {
    render(<AISettingsTab />);
    const input = screen.getByPlaceholderText('Command name (e.g., mycheck)');
    fireEvent.change(input, { target: { value: 'mytool' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useSettingsStore.getState().customSafeCommands).toContain('mytool');
  });

  it('shows authentication status', () => {
    render(<AISettingsTab />);
    expect(screen.getByText('Not Authenticated')).toBeTruthy();
  });
});
