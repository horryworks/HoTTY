import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OpenAIAuthPanel } from './OpenAIAuthPanel';

describe('OpenAIAuthPanel', () => {
    const baseProps = {
        apiKey: 'sk-test-key',
        setApiKey: vi.fn(),
        isAuthLoading: false,
        onLogin: vi.fn(),
        authError: null,
    };

    it('renders "Connect to OpenAI" heading', () => {
        render(<OpenAIAuthPanel {...baseProps} />);
        expect(screen.getByRole('heading', { name: 'Connect to OpenAI' })).toBeInTheDocument();
    });

    it('renders API key input with correct value', () => {
        render(<OpenAIAuthPanel {...baseProps} />);
        expect(screen.getByDisplayValue('sk-test-key')).toBeInTheDocument();
    });

    it('button is disabled when apiKey is empty', () => {
        render(<OpenAIAuthPanel {...baseProps} apiKey="" />);
        expect(screen.getByRole('button', { name: /connect to openai/i })).toBeDisabled();
    });

    it('button is disabled when isAuthLoading is true', () => {
        render(<OpenAIAuthPanel {...baseProps} isAuthLoading={true} />);
        expect(screen.getByRole('button', { name: /connecting/i })).toBeDisabled();
    });

    it('button is enabled when apiKey is provided and not loading', () => {
        render(<OpenAIAuthPanel {...baseProps} />);
        expect(screen.getByRole('button', { name: /connect to openai/i })).not.toBeDisabled();
    });

    it('clicking the button calls onLogin', () => {
        const onLogin = vi.fn();
        render(<OpenAIAuthPanel {...baseProps} onLogin={onLogin} />);
        fireEvent.click(screen.getByRole('button', { name: /connect to openai/i }));
        expect(onLogin).toHaveBeenCalledTimes(1);
    });

    it('shows auth error when authError is set', () => {
        render(<OpenAIAuthPanel {...baseProps} authError="Invalid API key" />);
        expect(screen.getByText('Invalid API key')).toBeInTheDocument();
    });

    it('does not show error when authError is null', () => {
        render(<OpenAIAuthPanel {...baseProps} authError={null} />);
        expect(screen.queryByText('Invalid API key')).not.toBeInTheDocument();
    });

    it('changing input calls setApiKey', () => {
        const setApiKey = vi.fn();
        render(<OpenAIAuthPanel {...baseProps} setApiKey={setApiKey} />);
        fireEvent.change(screen.getByDisplayValue('sk-test-key'), { target: { value: 'sk-new' } });
        expect(setApiKey).toHaveBeenCalledWith('sk-new');
    });
});
