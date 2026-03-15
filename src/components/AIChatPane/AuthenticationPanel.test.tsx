import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthenticationPanel } from './AuthenticationPanel';

describe('AuthenticationPanel', () => {
    const baseProps = {
        clientId: 'my-client-id',
        setClientId: vi.fn(),
        clientSecret: 'my-client-secret',
        setClientSecret: vi.fn(),
        isAuthLoading: false,
        onLogin: vi.fn(),
        authError: null,
    };

    it('renders "Connect to Gemini" heading', () => {
        render(<AuthenticationPanel {...baseProps} />);
        expect(screen.getByText('Connect to Gemini')).toBeInTheDocument();
    });

    it('renders Client ID and Client Secret inputs', () => {
        render(<AuthenticationPanel {...baseProps} />);
        // Labels exist without htmlFor; find inputs by their current values
        expect(screen.getByDisplayValue('my-client-id')).toBeInTheDocument();
        expect(screen.getByDisplayValue('my-client-secret')).toBeInTheDocument();
    });

    it('button is disabled when clientId is empty', () => {
        render(<AuthenticationPanel {...baseProps} clientId="" />);
        expect(screen.getByRole('button', { name: /sign in with google/i })).toBeDisabled();
    });

    it('button is disabled when clientSecret is empty', () => {
        render(<AuthenticationPanel {...baseProps} clientSecret="" />);
        expect(screen.getByRole('button', { name: /sign in with google/i })).toBeDisabled();
    });

    it('button is disabled when isAuthLoading is true', () => {
        render(<AuthenticationPanel {...baseProps} isAuthLoading={true} />);
        expect(screen.getByRole('button', { name: /connecting/i })).toBeDisabled();
    });

    it('button is enabled when both clientId and clientSecret are provided', () => {
        render(<AuthenticationPanel {...baseProps} />);
        expect(screen.getByRole('button', { name: /sign in with google/i })).not.toBeDisabled();
    });

    it('clicking the button calls onLogin', () => {
        const onLogin = vi.fn();
        render(<AuthenticationPanel {...baseProps} onLogin={onLogin} />);
        fireEvent.click(screen.getByRole('button', { name: /sign in with google/i }));
        expect(onLogin).toHaveBeenCalledTimes(1);
    });

    it('shows auth error message when authError is not null', () => {
        render(<AuthenticationPanel {...baseProps} authError="Invalid credentials" />);
        expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });

    it('does not show error when authError is null', () => {
        render(<AuthenticationPanel {...baseProps} authError={null} />);
        expect(screen.queryByText('Invalid credentials')).not.toBeInTheDocument();
    });

    it('changing clientId input calls setClientId', () => {
        const setClientId = vi.fn();
        render(<AuthenticationPanel {...baseProps} setClientId={setClientId} />);
        // The Client ID input is a text input (first textbox in the form)
        const textInput = screen.getByDisplayValue('my-client-id');
        fireEvent.change(textInput, { target: { value: 'new-id' } });
        expect(setClientId).toHaveBeenCalledWith('new-id');
    });
});
