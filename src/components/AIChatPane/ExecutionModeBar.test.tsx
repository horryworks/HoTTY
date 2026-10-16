import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExecutionModeBar } from './ExecutionModeBar';
import { useSettingsStore } from '../../stores/settingsStore';

const setAuto = (max = 5) => {
    useSettingsStore.getState().update('commandExecutionMode', 'auto-execute-safe');
    useSettingsStore.getState().update('maxConsecutiveAutoExecutions', max);
};

describe('ExecutionModeBar (mode pair + limit popover)', () => {
    beforeEach(() => {
        useSettingsStore.getState().reset();
    });

    it('shows both modes with "Ask each time" pressed by default, and no limit button', () => {
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        expect(screen.getByRole('button', { name: 'Ask each time' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('false');
        expect(screen.queryByRole('button', { name: /^Max / })).toBeNull();
    });

    it('pressing Auto switches the mode at once', () => {
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
        expect(useSettingsStore.getState().commandExecutionMode).toBe('auto-execute-safe');
    });

    it('pressing "Ask each time" switches back', () => {
        setAuto();
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: 'Ask each time' }));
        expect(useSettingsStore.getState().commandExecutionMode).toBe('ask-before-execute');
    });

    it('shows the run limit beside Auto ("Max 5")', () => {
        setAuto(5);
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        expect(screen.getByRole('button', { name: 'Max 5' })).toBeTruthy();
    });

    it('shows "Max ∞" when unlimited (max=0)', () => {
        setAuto(0);
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        expect(screen.getByRole('button', { name: 'Max ∞' })).toBeTruthy();
    });

    it('opens the limit popover with the max input and Pause', () => {
        setAuto();
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        const limit = screen.getByRole('button', { name: 'Max 5' });
        expect(limit.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(limit);
        expect(screen.getByRole('dialog', { name: /Execution mode settings/i })).toBeTruthy();
        expect(screen.getByLabelText('Max consecutive runs')).toBeTruthy();
        expect(screen.getByRole('button', { name: /Pause auto-execution/i })).toBeTruthy();
    });

    it('updates max when number input changes', () => {
        setAuto(5);
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: 'Max 5' }));
        fireEvent.change(screen.getByLabelText('Max consecutive runs'), { target: { value: '3' } });
        expect(useSettingsStore.getState().maxConsecutiveAutoExecutions).toBe(3);
    });

    it('toggling Unlimited (∞) sets max to 0, and un-checking restores a sane default', () => {
        setAuto(5);
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: 'Max 5' }));
        fireEvent.click(screen.getByRole('checkbox'));
        expect(useSettingsStore.getState().maxConsecutiveAutoExecutions).toBe(0);
        fireEvent.click(screen.getByRole('checkbox'));
        expect(useSettingsStore.getState().maxConsecutiveAutoExecutions).toBeGreaterThan(0);
    });

    it('clicking Pause invokes onPausedChange(true)', () => {
        setAuto();
        const onPausedChange = vi.fn();
        render(<ExecutionModeBar paused={false} onPausedChange={onPausedChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Max 5' }));
        fireEvent.click(screen.getByRole('button', { name: /Pause auto-execution/i }));
        expect(onPausedChange).toHaveBeenCalledWith(true);
    });

    it('when paused, the limit button says Paused in the warning style and offers Resume', () => {
        setAuto();
        const onPausedChange = vi.fn();
        render(<ExecutionModeBar paused={true} onPausedChange={onPausedChange} />);
        const limit = screen.getByRole('button', { name: 'Paused' });
        expect(limit.classList.contains('paused')).toBe(true);
        fireEvent.click(limit);
        fireEvent.click(screen.getByRole('button', { name: /Resume auto-execution/i }));
        expect(onPausedChange).toHaveBeenCalledWith(false);
    });

    it('closes the popover on Escape and when switching back to "Ask each time"', () => {
        setAuto();
        render(<ExecutionModeBar paused={false} onPausedChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: 'Max 5' }));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Max 5' }));
        fireEvent.click(screen.getByRole('button', { name: 'Ask each time' }));
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
