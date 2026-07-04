import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthenticationPanel } from './AuthenticationPanel';

describe('AuthenticationPanel', () => {
  const defaultProps = {
    clientId: '',
    setClientId: vi.fn(),
    clientSecret: '',
    setClientSecret: vi.fn(),
    isAuthLoading: false,
    onLogin: vi.fn(),
    authError: null,
  };

  it('renders Connect to Gemini heading', () => {
    render(<AuthenticationPanel {...defaultProps} />);
    expect(screen.getByText('Connect to Gemini')).toBeTruthy();
  });

  it('renders Client ID and Client Secret inputs', () => {
    render(<AuthenticationPanel {...defaultProps} />);
    expect(screen.getByText('Client ID')).toBeTruthy();
    expect(screen.getByText('Client Secret')).toBeTruthy();
  });

  it('disables login button when fields are empty', () => {
    render(<AuthenticationPanel {...defaultProps} />);
    const btn = screen.getByText('Sign in with Google');
    expect(btn).toHaveProperty('disabled', true);
  });

  it('enables login button when both fields have values', () => {
    render(<AuthenticationPanel {...defaultProps} clientId="id" clientSecret="secret" />);
    const btn = screen.getByText('Sign in with Google');
    expect(btn).toHaveProperty('disabled', false);
  });

  it('shows loading text when authenticating', () => {
    render(<AuthenticationPanel {...defaultProps} clientId="id" clientSecret="secret" isAuthLoading />);
    expect(screen.getByText('Connecting...')).toBeTruthy();
  });

  it('calls setClientId on input change', () => {
    const setClientId = vi.fn();
    render(<AuthenticationPanel {...defaultProps} setClientId={setClientId} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'new-id' } });
    expect(setClientId).toHaveBeenCalledWith('new-id');
  });

  it('calls onLogin when button is clicked', () => {
    const onLogin = vi.fn();
    render(<AuthenticationPanel {...defaultProps} clientId="id" clientSecret="secret" onLogin={onLogin} />);
    fireEvent.click(screen.getByText('Sign in with Google'));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('displays auth error when present', () => {
    render(<AuthenticationPanel {...defaultProps} authError="Invalid credentials" />);
    expect(screen.getByText('Invalid credentials')).toBeTruthy();
  });

  it('does not display error when null', () => {
    const { container } = render(<AuthenticationPanel {...defaultProps} />);
    expect(container.querySelector('.settings-ai-auth-error')).toBeNull();
  });
});
