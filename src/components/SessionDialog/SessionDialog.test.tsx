import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectionDialog } from './SessionDialog';

vi.mock('./SessionDialog.css', () => ({}));
vi.mock('./HostTree.css', () => ({}));
vi.mock('../../hooks/useHostManager', () => ({
    useHostManager: vi.fn(() => ({
        tree: [],
        addFolder: vi.fn(),
        addHost: vi.fn(),
        editNode: vi.fn(),
        deleteNode: vi.fn(),
        moveNode: vi.fn(),
        sortFolder: vi.fn(),
    })),
    decryptBatch: vi.fn(() => Promise.resolve([])),
    getCachedCredential: vi.fn(),
    clearDecryptedCache: vi.fn(),
    flattenHosts: vi.fn(() => []),
    getJumpboxReferences: vi.fn(() => []),
}));
vi.mock('../../hooks/useResize', () => ({
    useResize: vi.fn(() => ({ startResize: vi.fn() })),
}));
vi.mock('./HostTree', () => ({
    HostTree: () => <div data-testid="host-tree" />,
}));
vi.mock('../../services/electronService', () => ({
    listSerialPorts: vi.fn(() => Promise.resolve([])),
    listWslDistributions: vi.fn(() => Promise.resolve([])),
    getSshAlgorithms: vi.fn(() => Promise.resolve({})),
    logDebug: vi.fn(),
    focusWindow: vi.fn(),
}));
vi.mock('../../constants/storage', () => ({
    STORAGE_KEYS: {
        HOST_HISTORY: 'host-history',
        UI_TREE_PANEL_WIDTH: 'tree-panel-width',
        UI_DIALOG_SIZE: 'dialog-size',
        UI_DIALOG_POS: 'dialog-pos',
    },
}));

const baseProps = {
    onConnect: vi.fn(),
    onClose: vi.fn(),
    getCachedPassword: vi.fn(() => ''),
    saveCachedPassword: vi.fn(),
};

describe('ConnectionDialog', () => {
    it('renders without crashing', () => {
        const { container } = render(<ConnectionDialog {...baseProps} />);
        expect(container).toBeTruthy();
    });

    it('renders the host tree', () => {
        render(<ConnectionDialog {...baseProps} />);
        expect(screen.getByTestId('host-tree')).toBeInTheDocument();
    });

    it('has a "Connect" button', () => {
        render(<ConnectionDialog {...baseProps} />);
        expect(screen.getByText('Connect')).toBeInTheDocument();
    });

    it('renders with an error message when error prop is provided', () => {
        render(<ConnectionDialog {...baseProps} error="Connection failed" />);
        expect(screen.getByText('Connection failed')).toBeInTheDocument();
    });

    it('renders without error when error prop is null', () => {
        const { container } = render(<ConnectionDialog {...baseProps} error={null} />);
        expect(container).toBeTruthy();
    });

    it('shows username and password fields for SSH protocol', () => {
        render(<ConnectionDialog {...baseProps} />);
        // Default protocol is SSH — find labels by text
        expect(screen.getByText('Username')).toBeInTheDocument();
        expect(screen.getByText('Password')).toBeInTheDocument();
    });

    it('shows username and password fields for Telnet protocol', () => {
        render(<ConnectionDialog {...baseProps} />);
        const protocolSelect = screen.getByDisplayValue('SSH');
        fireEvent.change(protocolSelect, { target: { value: 'telnet' } });
        expect(screen.getByText('Username')).toBeInTheDocument();
        expect(screen.getByText('Password')).toBeInTheDocument();
    });

    it('does not require username for Telnet protocol', () => {
        render(<ConnectionDialog {...baseProps} />);
        const protocolSelect = screen.getByDisplayValue('SSH');
        fireEvent.change(protocolSelect, { target: { value: 'telnet' } });
        const usernameLabel = screen.getByText('Username');
        const usernameInput = usernameLabel.parentElement?.querySelector('input');
        expect(usernameInput).not.toBeNull();
        expect(usernameInput!.required).toBe(false);
    });

    it('requires username for SSH protocol', () => {
        render(<ConnectionDialog {...baseProps} />);
        const usernameLabel = screen.getByText('Username');
        const usernameInput = usernameLabel.parentElement?.querySelector('input');
        expect(usernameInput).not.toBeNull();
        expect(usernameInput!.required).toBe(true);
    });
});
