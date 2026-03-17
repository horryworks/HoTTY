import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VertexAIAuthPanel } from './VertexAIAuthPanel';

vi.mock('../../services/electronService', () => ({
    selectServiceAccountKeyFile: vi.fn(() => Promise.resolve(null)),
}));

describe('VertexAIAuthPanel', () => {
    const baseProps = {
        projectId: 'my-project',
        setProjectId: vi.fn(),
        location: 'us-central1',
        setLocation: vi.fn(),
        authType: 'adc' as const,
        setAuthType: vi.fn(),
        keyFilePath: '',
        setKeyFilePath: vi.fn(),
        isAuthLoading: false,
        onLogin: vi.fn(),
        authError: null,
    };

    it('renders "Connect to Vertex AI" heading', () => {
        render(<VertexAIAuthPanel {...baseProps} />);
        expect(screen.getByRole('heading', { name: 'Connect to Vertex AI' })).toBeInTheDocument();
    });

    it('renders project ID and location inputs', () => {
        render(<VertexAIAuthPanel {...baseProps} />);
        expect(screen.getByDisplayValue('my-project')).toBeInTheDocument();
        expect(screen.getByDisplayValue('us-central1')).toBeInTheDocument();
    });

    it('renders auth type select with adc selected', () => {
        render(<VertexAIAuthPanel {...baseProps} />);
        const select = screen.getByRole('combobox') as HTMLSelectElement;
        expect(select.value).toBe('adc');
    });

    it('does not show key file input when authType is adc', () => {
        render(<VertexAIAuthPanel {...baseProps} authType="adc" />);
        expect(screen.queryByPlaceholderText('/path/to/service-account-key.json')).not.toBeInTheDocument();
    });

    it('shows key file input when authType is service_account', () => {
        render(<VertexAIAuthPanel {...baseProps} authType="service_account" />);
        expect(screen.getByPlaceholderText('/path/to/service-account-key.json')).toBeInTheDocument();
    });

    it('button is disabled when projectId is empty', () => {
        render(<VertexAIAuthPanel {...baseProps} projectId="" />);
        expect(screen.getByRole('button', { name: /connect to vertex ai/i })).toBeDisabled();
    });

    it('button is disabled when location is empty', () => {
        render(<VertexAIAuthPanel {...baseProps} location="" />);
        expect(screen.getByRole('button', { name: /connect to vertex ai/i })).toBeDisabled();
    });

    it('button is disabled when service_account and keyFilePath is empty', () => {
        render(<VertexAIAuthPanel {...baseProps} authType="service_account" keyFilePath="" />);
        expect(screen.getByRole('button', { name: /connect to vertex ai/i })).toBeDisabled();
    });

    it('button is enabled for service_account when keyFilePath is set', () => {
        render(<VertexAIAuthPanel {...baseProps} authType="service_account" keyFilePath="/path/key.json" />);
        expect(screen.getByRole('button', { name: /connect to vertex ai/i })).not.toBeDisabled();
    });

    it('button is disabled when isAuthLoading is true', () => {
        render(<VertexAIAuthPanel {...baseProps} isAuthLoading={true} />);
        expect(screen.getByRole('button', { name: /connecting/i })).toBeDisabled();
    });

    it('button is enabled with valid adc config', () => {
        render(<VertexAIAuthPanel {...baseProps} />);
        expect(screen.getByRole('button', { name: /connect to vertex ai/i })).not.toBeDisabled();
    });

    it('clicking connect button calls onLogin', () => {
        const onLogin = vi.fn();
        render(<VertexAIAuthPanel {...baseProps} onLogin={onLogin} />);
        fireEvent.click(screen.getByRole('button', { name: /connect to vertex ai/i }));
        expect(onLogin).toHaveBeenCalledTimes(1);
    });

    it('shows auth error when authError is set', () => {
        render(<VertexAIAuthPanel {...baseProps} authError="Auth failed" />);
        expect(screen.getByText('Auth failed')).toBeInTheDocument();
    });

    it('does not show error when authError is null', () => {
        render(<VertexAIAuthPanel {...baseProps} authError={null} />);
        expect(screen.queryByText('Auth failed')).not.toBeInTheDocument();
    });

    it('changing projectId input calls setProjectId', () => {
        const setProjectId = vi.fn();
        render(<VertexAIAuthPanel {...baseProps} setProjectId={setProjectId} />);
        fireEvent.change(screen.getByDisplayValue('my-project'), { target: { value: 'new-project' } });
        expect(setProjectId).toHaveBeenCalledWith('new-project');
    });

    it('changing location input calls setLocation', () => {
        const setLocation = vi.fn();
        render(<VertexAIAuthPanel {...baseProps} setLocation={setLocation} />);
        fireEvent.change(screen.getByDisplayValue('us-central1'), { target: { value: 'europe-west4' } });
        expect(setLocation).toHaveBeenCalledWith('europe-west4');
    });

    it('changing auth type select calls setAuthType', () => {
        const setAuthType = vi.fn();
        render(<VertexAIAuthPanel {...baseProps} setAuthType={setAuthType} />);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'service_account' } });
        expect(setAuthType).toHaveBeenCalledWith('service_account');
    });

    it('Browse button calls selectServiceAccountKeyFile and updates path', async () => {
        const { selectServiceAccountKeyFile } = await import('../../services/electronService');
        (selectServiceAccountKeyFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce('/chosen/key.json');

        const setKeyFilePath = vi.fn();
        render(<VertexAIAuthPanel {...baseProps} authType="service_account" setKeyFilePath={setKeyFilePath} />);
        fireEvent.click(screen.getByText('Browse...'));
        await vi.waitFor(() => {
            expect(setKeyFilePath).toHaveBeenCalledWith('/chosen/key.json');
        });
    });

    it('Browse button does not update path when dialog is cancelled', async () => {
        const { selectServiceAccountKeyFile } = await import('../../services/electronService');
        (selectServiceAccountKeyFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

        const setKeyFilePath = vi.fn();
        render(<VertexAIAuthPanel {...baseProps} authType="service_account" setKeyFilePath={setKeyFilePath} />);
        fireEvent.click(screen.getByText('Browse...'));
        await vi.waitFor(() => {
            expect(selectServiceAccountKeyFile).toHaveBeenCalled();
        });
        expect(setKeyFilePath).not.toHaveBeenCalled();
    });
});
