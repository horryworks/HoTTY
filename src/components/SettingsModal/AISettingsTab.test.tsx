import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { AISettingsTab } from './AISettingsTab';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAiAuthStore } from '../../stores/aiAuthStore';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    aiSetProvider: vi.fn().mockResolvedValue(undefined),
    aiAuthStart: vi.fn().mockResolvedValue(true),
    aiAuthStatus: vi.fn().mockResolvedValue(false),
    aiAuthLogout: vi.fn().mockResolvedValue(undefined),
    dpapiEncrypt: vi.fn(async (v: string) => `enc:${v}`),
    dpapiDecrypt: vi.fn(async (v: string) => v.replace(/^enc:/, '')),
    selectServiceAccountKeyFile: vi.fn().mockResolvedValue(null),
  },
}));

const { tauriService } = await import('../../services/tauriService');

describe('AISettingsTab', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    act(() => {
      useAiAuthStore.setState({ isAuthenticated: false, isAuthLoading: false, authError: null });
    });
    localStorage.clear();
    vi.clearAllMocks();
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

  it('shows the Gemini sign-in form when unauthenticated (default provider)', () => {
    render(<AISettingsTab />);
    expect(screen.getByRole('heading', { name: 'Connect to Gemini' })).toBeTruthy();
    expect(screen.getByText('Client ID')).toBeTruthy();
    expect(screen.getByText('Client Secret')).toBeTruthy();
    const btn = screen.getByText('Sign in with Google', { selector: 'button' });
    expect(btn).toHaveProperty('disabled', true);
  });

  it('shows the sign-in form for the selected provider', () => {
    useSettingsStore.getState().update('activeAiProvider', 'openai');
    render(<AISettingsTab />);
    expect(screen.getByRole('heading', { name: 'Connect to OpenAI' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Connect to Gemini' })).toBeNull();
  });

  it('starts a Gemini sign-in with the entered credentials', async () => {
    render(<AISettingsTab />);
    const form = document.querySelector('.settings-ai-auth-form')!;
    const inputs = form.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: 'my-id' } });
    fireEvent.change(inputs[1], { target: { value: 'my-secret' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Sign in with Google', { selector: 'button' }));
    });
    await waitFor(() => {
      expect(tauriService.aiSetProvider).toHaveBeenCalledWith('gemini');
      expect(tauriService.aiAuthStart).toHaveBeenCalledWith({ clientId: 'my-id', clientSecret: 'my-secret' });
    });
    // Credentials are persisted DPAPI-encrypted, never in plaintext.
    expect(localStorage.getItem('hotty_gemini_client_id')).toBe('enc:my-id');
    expect(localStorage.getItem('hotty_gemini_client_secret')).toBe('enc:my-secret');
  });

  it('starts a Vertex AI sign-in and persists the connection settings', async () => {
    useSettingsStore.getState().update('activeAiProvider', 'vertexai');
    render(<AISettingsTab />);
    fireEvent.change(screen.getByPlaceholderText('my-project-id'), { target: { value: 'proj-1' } });
    fireEvent.change(screen.getByPlaceholderText('us-central1'), { target: { value: 'asia-northeast1' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Connect to Vertex AI', { selector: 'button' }));
    });
    await waitFor(() => {
      expect(tauriService.aiAuthStart).toHaveBeenCalledWith({
        projectId: 'proj-1',
        location: 'asia-northeast1',
        authType: 'adc',
        keyFilePath: undefined,
      });
    });
    expect(localStorage.getItem('hotty_vertexai_selected_region')).toBe('asia-northeast1');
  });

  it('shows the connecting state while a sign-in is pending', () => {
    act(() => { useAiAuthStore.setState({ isAuthLoading: true }); });
    render(<AISettingsTab />);
    expect(screen.getByText('Connecting...')).toBeTruthy();
  });

  it('shows the timed-out error from the auth store', () => {
    act(() => { useAiAuthStore.setState({ authError: 'timedOut' }); });
    render(<AISettingsTab />);
    expect(screen.getByText('Authentication timed out. Please try again.')).toBeTruthy();
  });

  it('hides the sign-in form and offers Logout when authenticated', () => {
    act(() => { useAiAuthStore.setState({ isAuthenticated: true }); });
    render(<AISettingsTab />);
    expect(screen.getByText('Authenticated')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Connect to Gemini' })).toBeNull();
    expect(screen.getByText('Logout', { selector: 'button' })).toBeTruthy();
  });

  it('logs out through the confirm dialog', async () => {
    act(() => { useAiAuthStore.setState({ isAuthenticated: true }); });
    render(<AISettingsTab />);
    fireEvent.click(screen.getByText('Logout', { selector: 'button' }));
    // Confirm dialog: pick its confirm button (the last "Logout" in the DOM).
    const buttons = screen.getAllByText('Logout', { selector: 'button' });
    await act(async () => {
      fireEvent.click(buttons[buttons.length - 1]);
    });
    await waitFor(() => {
      expect(tauriService.aiAuthLogout).toHaveBeenCalledTimes(1);
    });
    expect(useAiAuthStore.getState().isAuthenticated).toBe(false);
    expect(localStorage.getItem('hotty_ai_explicit_logout')).toBe('1');
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

  it('toggles the client-side sleep delay setting (default on)', () => {
    render(<AISettingsTab />);
    const checkbox = screen.getByText(/Run leading .*sleep.* as a client-side delay/)
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(useSettingsStore.getState().aiSleepAsClientDelay).toBe(false);
  });

  it('updates the max client-side delay', () => {
    render(<AISettingsTab />);
    const input = screen.getByText('Max client-side delay (seconds)')
      .closest('.settings-group')!
      .querySelector('input[type="number"][max="86400"]') as HTMLInputElement;
    expect(input.value).toBe('900');
    fireEvent.change(input, { target: { value: '300' } });
    expect(useSettingsStore.getState().aiSleepMaxDelaySecs).toBe(300);
  });

  it('disables the max-delay input when the toggle is off', () => {
    useSettingsStore.getState().update('aiSleepAsClientDelay', false);
    render(<AISettingsTab />);
    const input = screen.getByText('Max client-side delay (seconds)')
      .closest('.settings-group')!
      .querySelector('input[type="number"][max="86400"]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});
