import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExecutionModeBar } from './ExecutionModeBar';
import { useSettingsStore } from '../../stores/settingsStore';

describe('ExecutionModeBar (chip + popover)', () => {
    beforeEach(() => {
        useSettingsStore.getState().reset();
    });

    it('renders chip with "Ask before execute" label by default', () => {
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        const chip = screen.getByRole('button', { name: /Execution mode: Ask before execute/i });
        expect(chip).toBeTruthy();
        expect(chip.getAttribute('aria-expanded')).toBe('false');
    });

    it('shows "Auto · Max 5" when in auto mode with max=5', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        useSettingsStore.getState().update('maxConsecutiveAutoExecutions', 5);
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        expect(screen.getByText(/Auto · Max 5/)).toBeTruthy();
    });

    it('shows "Auto · Max ∞" when unlimited (max=0)', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        useSettingsStore.getState().update('maxConsecutiveAutoExecutions', 0);
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        expect(screen.getByText(/Auto · Max ∞/)).toBeTruthy();
    });

    it('opens popover on chip click and shows both mode options', () => {
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        const chip = screen.getByRole('button', { name: /Execution mode/i });
        fireEvent.click(chip);
        const dialog = screen.getByRole('dialog', { name: /Execution mode settings/i });
        expect(dialog).toBeTruthy();
        expect(screen.getByRole('radio', { name: /Ask before execute/i })).toBeTruthy();
        expect(screen.getByRole('radio', { name: /Auto-execute safe commands/i })).toBeTruthy();
    });

    it('marks "Ask before execute" radio as checked by default', () => {
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /Execution mode/i }));
        const askRadio = screen.getByRole('radio', { name: /Ask before execute/i });
        expect(askRadio.getAttribute('aria-checked')).toBe('true');
        const autoRadio = screen.getByRole('radio', { name: /Auto-execute safe commands/i });
        expect(autoRadio.getAttribute('aria-checked')).toBe('false');
    });

    it('clicking Auto radio switches to auto-execute mode', () => {
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /Execution mode/i }));
        fireEvent.click(screen.getByRole('radio', { name: /Auto-execute safe commands/i }));
        expect(useSettingsStore.getState().commandExecutionMode).toBe('auto-execute-safe');
    });

    it('hides Max input and Pause button when in ask-before-execute mode', () => {
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /Execution mode/i }));
        expect(screen.queryByLabelText('Max consecutive runs')).toBeNull();
        expect(screen.queryByRole('button', { name: /Pause auto-execution/i })).toBeNull();
    });

    it('shows Max input and Pause button when in auto mode', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /Execution mode/i }));
        expect(screen.getByLabelText('Max consecutive runs')).toBeTruthy();
        expect(screen.getByRole('button', { name: /Pause auto-execution/i })).toBeTruthy();
    });

    it('updates max when number input changes', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        useSettingsStore.getState().update('maxConsecutiveAutoExecutions', 5);
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /Execution mode/i }));
        const numInput = screen.getByLabelText('Max consecutive runs') as HTMLInputElement;
        fireEvent.change(numInput, { target: { value: '3' } });
        expect(useSettingsStore.getState().maxConsecutiveAutoExecutions).toBe(3);
    });

    it('toggling Unlimited (∞) sets max to 0', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        useSettingsStore.getState().update('maxConsecutiveAutoExecutions', 5);
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /Execution mode/i }));
        const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
        fireEvent.click(checkbox);
        expect(useSettingsStore.getState().maxConsecutiveAutoExecutions).toBe(0);
    });

    it('un-checking Unlimited restores a sane default', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        useSettingsStore.getState().update('maxConsecutiveAutoExecutions', 0);
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /Execution mode/i }));
        const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
        fireEvent.click(checkbox);
        expect(useSettingsStore.getState().maxConsecutiveAutoExecutions).toBeGreaterThan(0);
    });

    it('clicking Pause invokes onPausedChange(true)', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        const onPausedChange = vi.fn();
        render(<ExecutionModeBar paused={false} onPausedChange={onPausedChange} />);
        fireEvent.click(screen.getByRole('button', { name: /Execution mode/i }));
        fireEvent.click(screen.getByRole('button', { name: /Pause auto-execution/i }));
        expect(onPausedChange).toHaveBeenCalledWith(true);
    });

    it('renders Resume label and warning chip when paused', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        const { container } = render(<ExecutionModeBar paused={true} onPausedChange={() => {}} />);
        const chip = container.querySelector('.execution-mode-chip');
        expect(chip?.classList.contains('paused')).toBe(true);
        expect(screen.getByText('Paused')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Execution mode/i }));
        expect(screen.getByRole('button', { name: /Resume auto-execution/i })).toBeTruthy();
    });

    it('clicking Resume invokes onPausedChange(false)', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        const onPausedChange = vi.fn();
        render(<ExecutionModeBar paused={true} onPausedChange={onPausedChange} />);
        fireEvent.click(screen.getByRole('button', { name: /Execution mode/i }));
        fireEvent.click(screen.getByRole('button', { name: /Resume auto-execution/i }));
        expect(onPausedChange).toHaveBeenCalledWith(false);
    });

    it('closes popover on Escape key', () => {
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /Execution mode/i }));
        expect(screen.queryByRole('dialog')).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
