import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UpdateNotification } from './UpdateNotification';

vi.mock('../../services/electronService', () => ({
    openExternal: vi.fn(),
}));

vi.mock('./UpdateNotification.css', () => ({}));

import * as electronService from '../../services/electronService';

describe('UpdateNotification', () => {
    const baseProps = {
        version: '2.0.0',
        releaseUrl: 'https://example.com/release',
        onDismiss: vi.fn(),
        onSkip: vi.fn(),
        onNeverNotify: vi.fn(),
    };

    it('displays the new version number', () => {
        render(<UpdateNotification {...baseProps} />);
        expect(screen.getByText('v2.0.0')).toBeInTheDocument();
    });

    it('calls onDismiss when dismiss button is clicked', () => {
        const onDismiss = vi.fn();
        render(<UpdateNotification {...baseProps} onDismiss={onDismiss} />);
        fireEvent.click(screen.getByTitle('Close'));
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('opens release URL and dismisses when download button is clicked', () => {
        const onDismiss = vi.fn();
        render(<UpdateNotification {...baseProps} onDismiss={onDismiss} />);
        fireEvent.click(screen.getByText('Download'));
        expect(electronService.openExternal).toHaveBeenCalledWith('https://example.com/release');
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('calls onSkip when skip button is clicked', () => {
        const onSkip = vi.fn();
        render(<UpdateNotification {...baseProps} onSkip={onSkip} />);
        fireEvent.click(screen.getByText('Skip this version'));
        expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it('calls onNeverNotify when never notify button is clicked', () => {
        const onNeverNotify = vi.fn();
        render(<UpdateNotification {...baseProps} onNeverNotify={onNeverNotify} />);
        fireEvent.click(screen.getByText('Never Notify'));
        expect(onNeverNotify).toHaveBeenCalledTimes(1);
    });
});
