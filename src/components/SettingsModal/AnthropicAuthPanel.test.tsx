import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnthropicAuthPanel } from './AnthropicAuthPanel';

describe('AnthropicAuthPanel', () => {
  const defaultProps = {
    apiKey: '',
    setApiKey: vi.fn(),
    isAuthLoading: false,
    onLogin: vi.fn(),
    authError: null,
  };

  it('renders Connect to Anthropic heading', () => {
    render(<AnthropicAuthPanel {...defaultProps} />);
    expect(screen.getByRole('heading', { name: 'Connect to Anthropic' })).toBeTruthy();
  });

  it('renders API Key input with placeholder', () => {
    render(<AnthropicAuthPanel {...defaultProps} />);
    expect(screen.getByPlaceholderText('sk-ant-...')).toBeTruthy();
  });

  it('disables login button when API key is empty', () => {
    render(<AnthropicAuthPanel {...defaultProps} />);
    const btn = screen.getByText('Connect to Anthropic', { selector: 'button' });
    expect(btn).toHaveProperty('disabled', true);
  });

  it('enables login button when API key is provided', () => {
    render(<AnthropicAuthPanel {...defaultProps} apiKey="sk-ant-test" />);
    const btn = screen.getByText('Connect to Anthropic', { selector: 'button' });
    expect(btn).toHaveProperty('disabled', false);
  });

  it('shows loading text when authenticating', () => {
    render(<AnthropicAuthPanel {...defaultProps} apiKey="sk-ant-test" isAuthLoading />);
    expect(screen.getByText('Connecting...')).toBeTruthy();
  });

  it('calls setApiKey on input change', () => {
    const setApiKey = vi.fn();
    render(<AnthropicAuthPanel {...defaultProps} setApiKey={setApiKey} />);
    fireEvent.change(screen.getByPlaceholderText('sk-ant-...'), { target: { value: 'sk-ant-new' } });
    expect(setApiKey).toHaveBeenCalledWith('sk-ant-new');
  });

  it('calls onLogin when button is clicked', () => {
    const onLogin = vi.fn();
    render(<AnthropicAuthPanel {...defaultProps} apiKey="sk-ant-test" onLogin={onLogin} />);
    fireEvent.click(screen.getByText('Connect to Anthropic', { selector: 'button' }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('displays auth error when present', () => {
    render(<AnthropicAuthPanel {...defaultProps} authError="Invalid key" />);
    expect(screen.getByText('Invalid key')).toBeTruthy();
  });
});
