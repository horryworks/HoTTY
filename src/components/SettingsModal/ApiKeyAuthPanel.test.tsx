import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApiKeyAuthPanel } from './ApiKeyAuthPanel';

// ApiKeyAuthPanel is the provider-agnostic sign-in form shared by the OpenAI and
// Anthropic panels — the only per-provider difference is the three i18n keys it
// receives as props. These tests assert the shared behaviour plus that labels
// are driven entirely by the passed keys.
describe('ApiKeyAuthPanel', () => {
  const defaultProps = {
    titleKey: 'settings.ai.auth.openaiTitle',
    placeholderKey: 'settings.ai.auth.openaiKeyPlaceholder',
    connectKey: 'settings.ai.auth.connectOpenai',
    apiKey: '',
    setApiKey: vi.fn(),
    isAuthLoading: false,
    onLogin: vi.fn(),
    authError: null,
  };

  it('renders the translated title heading from titleKey', () => {
    render(<ApiKeyAuthPanel {...defaultProps} />);
    expect(screen.getByRole('heading', { name: 'Connect to OpenAI' })).toBeTruthy();
  });

  it('renders the API-key input with the translated placeholder', () => {
    render(<ApiKeyAuthPanel {...defaultProps} />);
    expect(screen.getByPlaceholderText('sk-...')).toBeTruthy();
  });

  it('masks the key with a password input', () => {
    render(<ApiKeyAuthPanel {...defaultProps} />);
    expect(screen.getByPlaceholderText('sk-...')).toHaveProperty('type', 'password');
  });

  it('disables the sign-in button when the key is empty', () => {
    render(<ApiKeyAuthPanel {...defaultProps} />);
    const btn = screen.getByText('Connect to OpenAI', { selector: 'button' });
    expect(btn).toHaveProperty('disabled', true);
  });

  it('enables the sign-in button once a key is entered', () => {
    render(<ApiKeyAuthPanel {...defaultProps} apiKey="sk-test" />);
    const btn = screen.getByText('Connect to OpenAI', { selector: 'button' });
    expect(btn).toHaveProperty('disabled', false);
  });

  it('shows loading text and stays disabled while authenticating', () => {
    render(<ApiKeyAuthPanel {...defaultProps} apiKey="sk-test" isAuthLoading />);
    const btn = screen.getByText('Connecting...', { selector: 'button' });
    expect(btn).toHaveProperty('disabled', true);
  });

  it('calls setApiKey on input change', () => {
    const setApiKey = vi.fn();
    render(<ApiKeyAuthPanel {...defaultProps} setApiKey={setApiKey} />);
    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'sk-new' } });
    expect(setApiKey).toHaveBeenCalledWith('sk-new');
  });

  it('calls onLogin when the button is clicked', () => {
    const onLogin = vi.fn();
    render(<ApiKeyAuthPanel {...defaultProps} apiKey="sk-test" onLogin={onLogin} />);
    fireEvent.click(screen.getByText('Connect to OpenAI', { selector: 'button' }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('displays the auth error when present', () => {
    render(<ApiKeyAuthPanel {...defaultProps} authError="Invalid API key" />);
    expect(screen.getByText('Invalid API key')).toBeTruthy();
  });

  it('does not render an auth error when none is provided', () => {
    render(<ApiKeyAuthPanel {...defaultProps} authError={null} />);
    expect(screen.queryByText('Invalid API key')).toBeNull();
  });

  it('drives all labels from the provided keys (Anthropic variant)', () => {
    render(
      <ApiKeyAuthPanel
        {...defaultProps}
        titleKey="settings.ai.auth.anthropicTitle"
        placeholderKey="settings.ai.auth.anthropicKeyPlaceholder"
        connectKey="settings.ai.auth.connectAnthropic"
      />
    );
    expect(screen.getByRole('heading', { name: 'Connect to Anthropic' })).toBeTruthy();
    expect(screen.getByPlaceholderText('sk-ant-...')).toBeTruthy();
  });
});
