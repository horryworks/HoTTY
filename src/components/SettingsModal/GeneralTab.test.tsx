import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GeneralTab } from './GeneralTab';

vi.mock('../../services/electronService', () => ({
    selectFolder: vi.fn(),
    openDebugLogFolder: vi.fn(),
}));

const baseProps = {
    loggingEnabled: false,
    onLoggingEnabledChange: vi.fn(),
    loggingPath: '',
    onLoggingPathChange: vi.fn(),
    scrollback: 10000,
    onScrollbackChange: vi.fn(),
    backspaceSendsDel: false,
    onBackspaceSendsDelChange: vi.fn(),
    rightClickPaste: true,
    onRightClickPasteChange: vi.fn(),
};

describe('GeneralTab', () => {
    it('renders Logging section', () => {
        render(<GeneralTab {...baseProps} />);
        expect(screen.getByText('Logging')).toBeInTheDocument();
    });

    it('renders Keyboard section', () => {
        render(<GeneralTab {...baseProps} />);
        expect(screen.getByText('Keyboard')).toBeInTheDocument();
    });

    it('renders Mouse section', () => {
        render(<GeneralTab {...baseProps} />);
        expect(screen.getByText('Mouse')).toBeInTheDocument();
    });

    it('renders Debug Log section', () => {
        render(<GeneralTab {...baseProps} />);
        expect(screen.getByText('Debug Log')).toBeInTheDocument();
    });

    it('shows log path input when logging is enabled', () => {
        render(<GeneralTab {...baseProps} loggingEnabled={true} />);
        expect(screen.getByText('Log Folder Path')).toBeInTheDocument();
    });

    it('calls onLoggingEnabledChange when checkbox clicked', () => {
        const fn = vi.fn();
        render(<GeneralTab {...baseProps} onLoggingEnabledChange={fn} />);
        fireEvent.click(screen.getByLabelText('Enable Logging'));
        expect(fn).toHaveBeenCalledWith(true);
    });
});
