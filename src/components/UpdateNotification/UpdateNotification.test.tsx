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
    };

    it('displays the new version number', () => {
        render(<UpdateNotification {...baseProps} />);
        expect(screen.getByText('v2.0.0')).toBeInTheDocument();
    });

    it('calls onDismiss when dismiss button is clicked', () => {
        const onDismiss = vi.fn();
        render(<UpdateNotification {...baseProps} onDismiss={onDismiss} />);
        fireEvent.click(screen.getByTitle('閉じる'));
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('opens release URL and dismisses when download button is clicked', () => {
        const onDismiss = vi.fn();
        render(<UpdateNotification {...baseProps} onDismiss={onDismiss} />);
        fireEvent.click(screen.getByText('ダウンロード'));
        expect(electronService.openExternal).toHaveBeenCalledWith('https://example.com/release');
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});
