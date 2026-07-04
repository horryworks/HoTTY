import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OpenAIAuthPanel } from './OpenAIAuthPanel';

describe('OpenAIAuthPanel', () => {
  const defaultProps = {
    apiKey: '',
    setApiKey: vi.fn(),
    isAuthLoading: false,
    onLogin: vi.fn(),
    authError: null,
  };

  it('renders Connect to OpenAI heading', () => {
    render(<OpenAIAuthPanel {...defaultProps} />);
    expect(screen.getByRole('heading', { name: 'Connect to OpenAI' })).toBeTruthy();
  });

  it('renders API Key input with placeholder', () => {
    render(<OpenAIAuthPanel {...defaultProps} />);
    expect(screen.getByPlaceholderText('sk-...')).toBeTruthy();
  });

  it('disables login button when API key is empty', () => {
    render(<OpenAIAuthPanel {...defaultProps} />);
    const btn = screen.getByText('Connect to OpenAI', { selector: 'button' });
    expect(btn).toHaveProperty('disabled', true);
  });

  it('enables login button when API key is provided', () => {
    render(<OpenAIAuthPanel {...defaultProps} apiKey="sk-test" />);
    const btn = screen.getByText('Connect to OpenAI', { selector: 'button' });
    expect(btn).toHaveProperty('disabled', false);
  });

  it('shows loading text when authenticating', () => {
    render(<OpenAIAuthPanel {...defaultProps} apiKey="sk-test" isAuthLoading />);
    expect(screen.getByText('Connecting...')).toBeTruthy();
  });

  it('calls setApiKey on input change', () => {
    const setApiKey = vi.fn();
    render(<OpenAIAuthPanel {...defaultProps} setApiKey={setApiKey} />);
    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'sk-new' } });
    expect(setApiKey).toHaveBeenCalledWith('sk-new');
  });

  it('calls onLogin when button is clicked', () => {
    const onLogin = vi.fn();
    render(<OpenAIAuthPanel {...defaultProps} apiKey="sk-test" onLogin={onLogin} />);
    fireEvent.click(screen.getByText('Connect to OpenAI', { selector: 'button' }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('displays auth error when present', () => {
    render(<OpenAIAuthPanel {...defaultProps} authError="Rate limit exceeded" />);
    expect(screen.getByText('Rate limit exceeded')).toBeTruthy();
  });
});
