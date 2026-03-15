import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskGeminiModal } from './AskGeminiModal';

vi.mock('./AskGeminiModal.css', () => ({}));

describe('AskGeminiModal', () => {
    const baseProps = {
        isOpen: true,
        selection: 'selected terminal text',
        onClose: vi.fn(),
        onSubmit: vi.fn(),
    };

    it('returns nothing when isOpen is false', () => {
        const { container } = render(<AskGeminiModal {...baseProps} isOpen={false} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders "Ask AI" title when open', () => {
        render(<AskGeminiModal {...baseProps} />);
        expect(screen.getByRole('heading', { name: 'Ask AI' })).toBeInTheDocument();
    });

    it('shows the selection text in a readonly textarea', () => {
        render(<AskGeminiModal {...baseProps} selection="my selected text" />);
        const readonlyTextarea = screen.getByDisplayValue('my selected text');
        expect(readonlyTextarea).toBeInTheDocument();
        expect(readonlyTextarea).toHaveAttribute('readonly');
    });

    it('"Ask" button is disabled when prompt is empty', () => {
        render(<AskGeminiModal {...baseProps} />);
        expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
    });

    it('"Ask" button is enabled after typing in the prompt textarea', () => {
        render(<AskGeminiModal {...baseProps} />);
        const promptTextarea = screen.getByPlaceholderText(/What would you like to ask/);
        fireEvent.change(promptTextarea, { target: { value: 'Explain this error' } });
        expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled();
    });

    it('clicking "Ask" calls onSubmit with prompt and selection, then calls onClose', () => {
        const onSubmit = vi.fn();
        const onClose = vi.fn();
        render(<AskGeminiModal {...baseProps} onSubmit={onSubmit} onClose={onClose} selection="sel" />);
        const promptTextarea = screen.getByPlaceholderText(/What would you like to ask/);
        fireEvent.change(promptTextarea, { target: { value: 'my prompt' } });
        fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
        expect(onSubmit).toHaveBeenCalledWith('my prompt', 'sel');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking "Cancel" calls onClose', () => {
        const onClose = vi.fn();
        render(<AskGeminiModal {...baseProps} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('pressing Escape in the prompt textarea calls onClose', () => {
        const onClose = vi.fn();
        render(<AskGeminiModal {...baseProps} onClose={onClose} />);
        const promptTextarea = screen.getByPlaceholderText(/What would you like to ask/);
        fireEvent.keyDown(promptTextarea, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('pressing Ctrl+Enter in the prompt textarea submits the form', () => {
        const onSubmit = vi.fn();
        const onClose = vi.fn();
        render(<AskGeminiModal {...baseProps} onSubmit={onSubmit} onClose={onClose} selection="sel" />);
        const promptTextarea = screen.getByPlaceholderText(/What would you like to ask/);
        fireEvent.change(promptTextarea, { target: { value: 'ctrl enter prompt' } });
        fireEvent.keyDown(promptTextarea, { key: 'Enter', ctrlKey: true });
        expect(onSubmit).toHaveBeenCalledWith('ctrl enter prompt', 'sel');
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
