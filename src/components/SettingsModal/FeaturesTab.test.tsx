import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeaturesTab } from './FeaturesTab';

const baseProps = {
    enabledFeatures: {
        'ai-chat': true, 'log-viewer': true, 'ping-monitor': true,
        'text-editor': true, 'file-explorer': true,
    } as Record<import('../../types/appTypes').FeatureId, boolean>,
    onFeatureToggle: vi.fn(),
};

describe('FeaturesTab', () => {
    it('renders all feature toggles', () => {
        render(<FeaturesTab {...baseProps} />);
        expect(screen.getByText('AI Chat')).toBeInTheDocument();
        expect(screen.getByText('Log Viewer')).toBeInTheDocument();
        expect(screen.getByText('Ping Monitor')).toBeInTheDocument();
        expect(screen.getByText('Text Editor')).toBeInTheDocument();
        expect(screen.getByText('File Explorer')).toBeInTheDocument();
    });

    it('calls onFeatureToggle when a feature checkbox is clicked', () => {
        const fn = vi.fn();
        render(<FeaturesTab {...baseProps} onFeatureToggle={fn} />);
        const aiCheckbox = screen.getByText('AI Chat').closest('label')!.querySelector('input')!;
        fireEvent.click(aiCheckbox);
        expect(fn).toHaveBeenCalledWith('ai-chat', false);
    });

    it('reflects disabled state when a feature is off', () => {
        render(<FeaturesTab {...baseProps} enabledFeatures={{ ...baseProps.enabledFeatures, 'ai-chat': false }} />);
        const aiCheckbox = screen.getByText('AI Chat').closest('label')!.querySelector('input') as HTMLInputElement;
        expect(aiCheckbox.checked).toBe(false);
    });
});
