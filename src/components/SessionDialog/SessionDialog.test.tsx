import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionDialog } from './SessionDialog';

// Mock tauriService
vi.mock('../../services/tauriService', () => ({
  tauriService: {
    focusWindow: vi.fn(),
    exportHtree: vi.fn(),
    selectImportFile: vi.fn(),
    decryptImportFile: vi.fn(),
    gceIapCheckGcloud: vi.fn(),
    gceIapCheckAuth: vi.fn(),
    gceIapListProjects: vi.fn(),
    gceIapListZones: vi.fn(),
    gceIapListInstances: vi.fn(),
    openExternal: vi.fn(),
    logDebug: vi.fn(),
    listSerialPorts: vi.fn().mockResolvedValue([]),
    listWslDistributions: vi.fn().mockResolvedValue([]),
    detectGitBash: vi.fn().mockResolvedValue(null),
    dpapiEncryptBatch: vi.fn(async (values: string[]) => values.map(v => `[SAFE]${v}`)),
    dpapiDecryptBatch: vi.fn(async (values: string[]) => values.map(v => v.replace(/^\[SAFE\]/, ''))),
  },
  isEncrypted: (value: string) => value.startsWith('[DPAPI]') || value.startsWith('[SAFE]'),
}));

// Mock dialog plugin
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onConnect: vi.fn(),
};

describe('SessionDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders nothing when not open', () => {
    const { container } = render(<SessionDialog {...defaultProps} open={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders when open', () => {
    render(<SessionDialog {...defaultProps} />);
    expect(screen.getByText('New Session')).toBeTruthy();
  });

  it('shows two-panel layout with tree and form', () => {
    const { container } = render(<SessionDialog {...defaultProps} />);
    expect(container.querySelector('.host-panel')).toBeTruthy();
    expect(container.querySelector('.form-panel')).toBeTruthy();
    expect(container.querySelector('.panel-divider')).toBeTruthy();
  });

  it('shows protocol selector', () => {
    render(<SessionDialog {...defaultProps} />);
    expect(screen.getByText('Protocol')).toBeTruthy();
    expect(screen.getByText('SSH')).toBeTruthy();
  });

  it('shows Connect button', () => {
    render(<SessionDialog {...defaultProps} />);
    expect(screen.getByText('Connect')).toBeTruthy();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<SessionDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('\u2715'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows host tree empty message when tree is empty', () => {
    render(<SessionDialog {...defaultProps} />);
    expect(screen.getByText(/Right-click or use the \+ buttons/)).toBeTruthy();
  });

  it('shows encoding selector', () => {
    render(<SessionDialog {...defaultProps} />);
    expect(screen.getByText('Encoding')).toBeTruthy();
  });

  it('shows Host/IP and Port fields for SSH protocol', () => {
    render(<SessionDialog {...defaultProps} />);
    expect(screen.getByText('Host/IP')).toBeTruthy();
    expect(screen.getByText('Port')).toBeTruthy();
    expect(screen.getByText('Username')).toBeTruthy();
    expect(screen.getByText('Password')).toBeTruthy();
  });

  it('shows Private Key Path for SSH protocol', () => {
    render(<SessionDialog {...defaultProps} />);
    expect(screen.getByText('Private Key Path (optional)')).toBeTruthy();
  });

  it('shows resize handle', () => {
    const { container } = render(<SessionDialog {...defaultProps} />);
    expect(container.querySelector('.dialog-resize-handle')).toBeTruthy();
  });
});
