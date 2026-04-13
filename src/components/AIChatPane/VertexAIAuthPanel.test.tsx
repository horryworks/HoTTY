import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VertexAIAuthPanel } from './VertexAIAuthPanel';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    selectServiceAccountKeyFile: vi.fn().mockResolvedValue(null),
  },
}));

describe('VertexAIAuthPanel', () => {
  const defaultProps = {
    projectId: '',
    setProjectId: vi.fn(),
    location: '',
    setLocation: vi.fn(),
    authType: 'adc' as const,
    setAuthType: vi.fn(),
    keyFilePath: '',
    setKeyFilePath: vi.fn(),
    isAuthLoading: false,
    onLogin: vi.fn(),
    authError: null,
  };

  it('renders Connect to Vertex AI heading', () => {
    render(<VertexAIAuthPanel {...defaultProps} />);
    expect(screen.getByRole('heading', { name: 'Connect to Vertex AI' })).toBeTruthy();
  });

  it('renders project ID and location inputs', () => {
    render(<VertexAIAuthPanel {...defaultProps} />);
    expect(screen.getByPlaceholderText('my-project-id')).toBeTruthy();
    expect(screen.getByPlaceholderText('us-central1')).toBeTruthy();
  });

  it('renders auth type selector', () => {
    render(<VertexAIAuthPanel {...defaultProps} />);
    expect(screen.getByText('Authentication Method')).toBeTruthy();
    expect(screen.getByText('Application Default Credentials (ADC)')).toBeTruthy();
  });

  it('disables login when project ID or location is empty', () => {
    render(<VertexAIAuthPanel {...defaultProps} />);
    const btn = screen.getByText('Connect to Vertex AI', { selector: 'button' });
    expect(btn).toHaveProperty('disabled', true);
  });

  it('enables login when project ID and location are provided', () => {
    render(<VertexAIAuthPanel {...defaultProps} projectId="my-proj" location="us-central1" />);
    const btn = screen.getByText('Connect to Vertex AI', { selector: 'button' });
    expect(btn).toHaveProperty('disabled', false);
  });

  it('shows service account key file input when auth type is service_account', () => {
    render(<VertexAIAuthPanel {...defaultProps} authType="service_account" />);
    expect(screen.getByPlaceholderText('/path/to/service-account-key.json')).toBeTruthy();
    expect(screen.getByText('Browse...')).toBeTruthy();
  });

  it('does not show Browse button when auth type is adc', () => {
    render(<VertexAIAuthPanel {...defaultProps} authType="adc" />);
    expect(screen.queryByText('Browse...')).toBeNull();
  });

  it('disables login when service_account is selected but no key file', () => {
    render(<VertexAIAuthPanel {...defaultProps} projectId="p" location="l" authType="service_account" />);
    const btn = screen.getByText('Connect to Vertex AI', { selector: 'button' });
    expect(btn).toHaveProperty('disabled', true);
  });

  it('enables login when service_account has key file', () => {
    render(<VertexAIAuthPanel {...defaultProps} projectId="p" location="l" authType="service_account" keyFilePath="/key.json" />);
    const btn = screen.getByText('Connect to Vertex AI', { selector: 'button' });
    expect(btn).toHaveProperty('disabled', false);
  });

  it('shows loading text when authenticating', () => {
    render(<VertexAIAuthPanel {...defaultProps} projectId="p" location="l" isAuthLoading />);
    expect(screen.getByText('Connecting...')).toBeTruthy();
  });

  it('calls setProjectId on input change', () => {
    const setProjectId = vi.fn();
    render(<VertexAIAuthPanel {...defaultProps} setProjectId={setProjectId} />);
    fireEvent.change(screen.getByPlaceholderText('my-project-id'), { target: { value: 'new-proj' } });
    expect(setProjectId).toHaveBeenCalledWith('new-proj');
  });

  it('calls onLogin when button is clicked', () => {
    const onLogin = vi.fn();
    render(<VertexAIAuthPanel {...defaultProps} projectId="p" location="l" onLogin={onLogin} />);
    fireEvent.click(screen.getByText('Connect to Vertex AI', { selector: 'button' }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('displays auth error when present', () => {
    render(<VertexAIAuthPanel {...defaultProps} authError="Auth failed" />);
    expect(screen.getByText('Auth failed')).toBeTruthy();
  });
});
