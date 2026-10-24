import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocalAuthPanel } from './LocalAuthPanel';

describe('LocalAuthPanel', () => {
  const defaultProps = {
    baseUrl: '',
    setBaseUrl: vi.fn(),
    apiKey: '',
    setApiKey: vi.fn(),
    isAuthLoading: false,
    onLogin: vi.fn(),
    authError: null,
  };

  it('shows an example address in the empty URL field', () => {
    render(<LocalAuthPanel {...defaultProps} />);
    expect(screen.getByPlaceholderText('http://localhost:11434')).toBeTruthy();
  });

  it('needs an address but not a key', () => {
    const { rerender } = render(<LocalAuthPanel {...defaultProps} />);
    const btn = () => screen.getByRole('button');
    expect(btn()).toHaveProperty('disabled', true);
    rerender(<LocalAuthPanel {...defaultProps} baseUrl="http://localhost:11434" />);
    expect(btn()).toHaveProperty('disabled', false);
  });

  it('passes typed values up and connects on click', () => {
    const setBaseUrl = vi.fn();
    const setApiKey = vi.fn();
    const onLogin = vi.fn();
    render(
      <LocalAuthPanel
        {...defaultProps}
        baseUrl="http://192.0.2.10:8080"
        setBaseUrl={setBaseUrl}
        setApiKey={setApiKey}
        onLogin={onLogin}
      />,
    );
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'http://localhost:1234' } });
    expect(setBaseUrl).toHaveBeenCalledWith('http://localhost:1234');
    fireEvent.change(screen.getByLabelText('API Key (optional)'), { target: { value: 'k' } });
    expect(setApiKey).toHaveBeenCalledWith('k');
    fireEvent.click(screen.getByRole('button'));
    expect(onLogin).toHaveBeenCalledOnce();
  });

  it('shows the error it is given', () => {
    render(<LocalAuthPanel {...defaultProps} authError="Nope" />);
    expect(screen.getByText('Nope')).toBeTruthy();
  });
});
