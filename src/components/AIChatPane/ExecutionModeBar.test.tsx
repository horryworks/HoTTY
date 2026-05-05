import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExecutionModeBar } from './ExecutionModeBar';
import { useSettingsStore } from '../../stores/settingsStore';

describe('ExecutionModeBar', () => {
    beforeEach(() => {
        useSettingsStore.getState().reset();
    });

    it('marks "Ask before execute" as active by default', () => {
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        const askBtn = screen.getByRole('button', { name: /Ask before execute/i });
        expect(askBtn.getAttribute('aria-pressed')).toBe('true');
        const autoBtn = screen.getByRole('button', { name: /Auto-execute safe commands/i });
        expect(autoBtn.getAttribute('aria-pressed')).toBe('false');
    });

    it('hides Pause button when in ask-before-execute mode', () => {
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        expect(screen.queryByRole('button', { name: /^Pause$/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Resume$/ })).toBeNull();
    });

    it('switches to auto-execute mode and reveals Pause button', () => {
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        const autoBtn = screen.getByRole('button', { name: /Auto-execute safe commands/i });
        fireEvent.click(autoBtn);
        expect(useSettingsStore.getState().commandExecutionMode).toBe('auto-execute-safe');
        expect(screen.getByRole('button', { name: /^Pause$/ })).toBeTruthy();
    });

    it('switches back to ask-before-execute when left pill clicked', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        const askBtn = screen.getByRole('button', { name: /Ask before execute/i });
        fireEvent.click(askBtn);
        expect(useSettingsStore.getState().commandExecutionMode).toBe('ask-before-execute');
    });

    it('shows "Max: ∞" when maxConsecutiveAutoExecutions is 0', () => {
        useSettingsStore.getState().update('maxConsecutiveAutoExecutions', 0);
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        expect(screen.getByText(/Max:\s*∞/)).toBeTruthy();
    });

    it('shows "Max: 5" when maxConsecutiveAutoExecutions is 5', () => {
        useSettingsStore.getState().update('maxConsecutiveAutoExecutions', 5);
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        expect(screen.getByText(/Max:\s*5/)).toBeTruthy();
    });

    it('opens popover and updates max when number input changes', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        useSettingsStore.getState().update('maxConsecutiveAutoExecutions', 5);
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        const badge = screen.getByRole('button', { name: /Max consecutive auto-executions/i });
        fireEvent.click(badge);
        const numInput = screen.getByLabelText('Max consecutive runs') as HTMLInputElement;
        fireEvent.change(numInput, { target: { value: '3' } });
        expect(useSettingsStore.getState().maxConsecutiveAutoExecutions).toBe(3);
    });

    it('toggling Unlimited sets max to 0', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        useSettingsStore.getState().update('maxConsecutiveAutoExecutions', 5);
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        const badge = screen.getByRole('button', { name: /Max consecutive auto-executions/i });
        fireEvent.click(badge);
        const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
        fireEvent.click(checkbox);
        expect(useSettingsStore.getState().maxConsecutiveAutoExecutions).toBe(0);
    });

    it('un-checking Unlimited restores a sane default', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        useSettingsStore.getState().update('maxConsecutiveAutoExecutions', 0);
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        const badge = screen.getByRole('button', { name: /Max consecutive auto-executions/i });
        fireEvent.click(badge);
        const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
        fireEvent.click(checkbox);
        expect(useSettingsStore.getState().maxConsecutiveAutoExecutions).toBeGreaterThan(0);
    });

    it('clicking Pause invokes onPausedChange(true)', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        const onPausedChange = vi.fn();
        render(<ExecutionModeBar paused={false} onPausedChange={onPausedChange} />);
        fireEvent.click(screen.getByRole('button', { name: /^Pause$/ }));
        expect(onPausedChange).toHaveBeenCalledWith(true);
    });

    it('renders Resume label and warning state when paused', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        const { container } = render(<ExecutionModeBar paused={true} onPausedChange={() => {}} />);
        expect(screen.getByRole('button', { name: /^Resume$/ })).toBeTruthy();
        expect(screen.getByText('Auto-execution paused')).toBeTruthy();
        const bar = container.querySelector('.execution-mode-bar');
        expect(bar?.classList.contains('paused')).toBe(true);
    });

    it('clicking Resume invokes onPausedChange(false)', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        const onPausedChange = vi.fn();
        render(<ExecutionModeBar paused={true} onPausedChange={onPausedChange} />);
        fireEvent.click(screen.getByRole('button', { name: /^Resume$/ }));
        expect(onPausedChange).toHaveBeenCalledWith(false);
    });

    it('clicking the Max badge while in ask mode also flips to auto mode', () => {
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        const badge = screen.getByRole('button', { name: /Max consecutive auto-executions/i });
        fireEvent.click(badge);
        expect(useSettingsStore.getState().commandExecutionMode).toBe('auto-execute-safe');
    });

    it('closes popover on Escape key', () => {
        useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        const badge = screen.getByRole('button', { name: /Max consecutive auto-executions/i });
        fireEvent.click(badge);
        expect(screen.queryByRole('dialog')).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
