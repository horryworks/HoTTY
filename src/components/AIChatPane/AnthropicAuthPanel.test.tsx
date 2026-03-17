import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnthropicAuthPanel } from './AnthropicAuthPanel';

describe('AnthropicAuthPanel', () => {
    const baseProps = {
        apiKey: 'sk-ant-test-key',
        setApiKey: vi.fn(),
        isAuthLoading: false,
        onLogin: vi.fn(),
        authError: null,
    };

    it('renders "Connect to Anthropic" heading', () => {
        render(<AnthropicAuthPanel {...baseProps} />);
        expect(screen.getByRole('heading', { name: 'Connect to Anthropic' })).toBeInTheDocument();
    });

    it('renders API key input with correct value', () => {
        render(<AnthropicAuthPanel {...baseProps} />);
        expect(screen.getByDisplayValue('sk-ant-test-key')).toBeInTheDocument();
    });

    it('button is disabled when apiKey is empty', () => {
        render(<AnthropicAuthPanel {...baseProps} apiKey="" />);
        expect(screen.getByRole('button', { name: /connect to anthropic/i })).toBeDisabled();
    });

    it('button is disabled when isAuthLoading is true', () => {
        render(<AnthropicAuthPanel {...baseProps} isAuthLoading={true} />);
        expect(screen.getByRole('button', { name: /connecting/i })).toBeDisabled();
    });

    it('button is enabled when apiKey is provided and not loading', () => {
        render(<AnthropicAuthPanel {...baseProps} />);
        expect(screen.getByRole('button', { name: /connect to anthropic/i })).not.toBeDisabled();
    });

    it('clicking the button calls onLogin', () => {
        const onLogin = vi.fn();
        render(<AnthropicAuthPanel {...baseProps} onLogin={onLogin} />);
        fireEvent.click(screen.getByRole('button', { name: /connect to anthropic/i }));
        expect(onLogin).toHaveBeenCalledTimes(1);
    });

    it('shows auth error when authError is set', () => {
        render(<AnthropicAuthPanel {...baseProps} authError="Invalid API key" />);
        expect(screen.getByText('Invalid API key')).toBeInTheDocument();
    });

    it('does not show error when authError is null', () => {
        render(<AnthropicAuthPanel {...baseProps} authError={null} />);
        expect(screen.queryByText('Invalid API key')).not.toBeInTheDocument();
    });

    it('changing input calls setApiKey', () => {
        const setApiKey = vi.fn();
        render(<AnthropicAuthPanel {...baseProps} setApiKey={setApiKey} />);
        fireEvent.change(screen.getByDisplayValue('sk-ant-test-key'), { target: { value: 'sk-ant-new' } });
        expect(setApiKey).toHaveBeenCalledWith('sk-ant-new');
    });
});
