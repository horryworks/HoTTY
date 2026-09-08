import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { VersionsTab } from './VersionsTab';
import { tauriService } from '../../services/tauriService';
import type { ReleaseEntry, UpdaterProgress } from '../../types/appTypes';

vi.mock('../../services/tauriService', () => ({
    tauriService: {
        listReleases: vi.fn(),
        installVersion: vi.fn().mockResolvedValue(undefined),
        cancelVersionInstall: vi.fn().mockResolvedValue(undefined),
        onUpdaterProgress: vi.fn(),
        getAppVersion: vi.fn(),
        openExternal: vi.fn().mockResolvedValue(undefined),
    },
}));

function entry(over: Partial<ReleaseEntry> & Pick<ReleaseEntry, 'version'>): ReleaseEntry {
    return {
        tag: `v${over.version}`,
        name: `v${over.version}`,
        prerelease: false,
        notes: '',
        htmlUrl: `https://github.com/horryworks/HoTTY/releases/tag/v${over.version}`,
        assetName: `HoTTY_${over.version}_x64-setup.exe`,
        size: 6_500_000,
        relation: 'older',
        installable: true,
        ...over,
    };
}

const RELEASES: ReleaseEntry[] = [
    entry({ version: '2.2.0', relation: 'newer', notes: '## Next stable\n\n- faster startup' }),
    entry({
        version: '2.1.0-beta1',
        prerelease: true,
        relation: 'current',
        notes: '## Beta build\n\n- worker sessions',
    }),
    entry({ version: '2.0.18', notes: '## Stable build\n\n- markdown links fixed' }),
    entry({ version: '2.0.17', installable: false }),
];

/** The row a version's name sits in, so a query can be scoped to just that row. */
function rowOf(version: string): HTMLElement {
    return screen.getByText(version).closest('.versions-row') as HTMLElement;
}

let progressCb: ((p: UpdaterProgress) => void) | null = null;

beforeEach(() => {
    vi.clearAllMocks();
    progressCb = null;
    vi.mocked(tauriService.getAppVersion).mockResolvedValue('2.1.0-beta1');
    vi.mocked(tauriService.listReleases).mockResolvedValue(RELEASES);
    vi.mocked(tauriService.onUpdaterProgress).mockImplementation((cb) => {
        progressCb = cb;
        return Promise.resolve(() => {});
    });
});

describe('VersionsTab', () => {
    it('lists releases newest first', async () => {
        render(<VersionsTab />);
        expect(await screen.findByText('2.1.0-beta1')).toBeTruthy();
        expect(screen.getByText('2.0.18')).toBeTruthy();
        expect(screen.getByText('2.0.17')).toBeTruthy();
    });

    it('marks the running version', async () => {
        render(<VersionsTab />);
        expect(await screen.findByText('Installed')).toBeTruthy();
    });

    it('shows pre-releases by default when running one, and hides them on demand', async () => {
        render(<VersionsTab />);
        // Running a beta, so the beta channel starts visible.
        const toggle = (await screen.findByLabelText('Show pre-releases')) as HTMLInputElement;
        await waitFor(() => expect(toggle.checked).toBe(true));
        expect(screen.getByText('2.1.0-beta1')).toBeTruthy();

        fireEvent.click(toggle);
        expect(screen.queryByText('2.1.0-beta1')).toBeNull();
        expect(screen.getByText('2.0.18')).toBeTruthy();
    });

    it('renders the selected release notes as markdown', async () => {
        const { container } = render(<VersionsTab />);
        fireEvent.click(await screen.findByText('2.0.18'));
        await waitFor(() => {
            expect(container.querySelector('.md-content h2')?.textContent).toBe('Stable build');
        });
        expect(container.querySelector('.md-content li')?.textContent).toContain(
            'markdown links fixed',
        );
    });

    it('warns before going back to an older version', async () => {
        render(<VersionsTab />);
        fireEvent.click(await screen.findByText('2.0.18'));
        expect(await screen.findByText(/hosts, themes and saved credentials are kept/)).toBeTruthy();
    });

    it('offers no action on the version already installed', async () => {
        render(<VersionsTab />);
        await screen.findByText('2.1.0-beta1');
        // Only the row's own select button — switching to where you already are
        // is not on offer.
        expect(within(rowOf('2.1.0-beta1')).getAllByRole('button')).toHaveLength(1);
        expect(screen.queryByRole('button', { name: /Switch to v2\.1\.0-beta1/ })).toBeNull();

        fireEvent.click(screen.getByText('2.1.0-beta1'));
        expect(screen.queryByText(/saved credentials are kept/)).toBeNull();
    });

    it('labels a newer release Upgrade and an older one Downgrade', async () => {
        render(<VersionsTab />);
        await screen.findByText('2.2.0');

        const up = within(rowOf('2.2.0')).getByRole('button', { name: /Switch to v2\.2\.0/ });
        expect(up.textContent).toBe('Upgrade');
        expect(up.className).toContain('upgrade');

        const down = within(rowOf('2.0.18')).getByRole('button', { name: /Switch to v2\.0\.18/ });
        expect(down.textContent).toBe('Downgrade');
        expect(down.className).toContain('downgrade');
    });

    it('puts the download size in the action tooltip, not in the row', async () => {
        render(<VersionsTab />);
        await screen.findByText('2.0.18');
        const row = rowOf('2.0.18');
        expect(
            within(row).getByRole('button', { name: /Switch to v2\.0\.18/ }).getAttribute('title'),
        ).toBe('Switch to v2.0.18 (6.2 MB)');
        expect(row.textContent).not.toContain('MB');
    });

    it('has no separate install button below the list', async () => {
        const { container } = render(<VersionsTab />);
        await screen.findByText('2.0.18');
        expect(container.querySelector('.versions-actions')).toBeNull();
        // Selecting a row must not bring one back.
        fireEvent.click(screen.getByText('2.0.18'));
        expect(container.querySelector('.versions-actions')).toBeNull();
    });

    it('sends only a tag and a language to the backend, never a URL', async () => {
        render(<VersionsTab />);
        await screen.findByText('2.0.18');
        fireEvent.click(within(rowOf('2.0.18')).getByRole('button', { name: /Switch to v2\.0\.18/ }));

        await waitFor(() => expect(tauriService.installVersion).toHaveBeenCalled());
        // The security contract: the renderer picks a tag, the backend resolves
        // it. If a URL ever shows up in this call, that guarantee is gone.
        expect(tauriService.installVersion).toHaveBeenCalledWith('v2.0.18', 'en');
        const args = vi.mocked(tauriService.installVersion).mock.calls[0];
        expect(JSON.stringify(args)).not.toContain('http');
    });

    it('selects the row it acts on, so the downgrade caveat is on screen', async () => {
        render(<VersionsTab />);
        await screen.findByText('2.0.18');
        // No prior click on the row: pressing Downgrade must select it too.
        fireEvent.click(within(rowOf('2.0.18')).getByRole('button', { name: /Switch to v2\.0\.18/ }));
        expect(await screen.findByText(/hosts, themes and saved credentials are kept/)).toBeTruthy();
    });

    it('refuses to install a release with no published checksum', async () => {
        render(<VersionsTab />);
        await screen.findByText('2.0.17');
        const button = within(rowOf('2.0.17')).getByRole('button', {
            name: /No published checksum/,
        }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
    });

    it('locks every action and offers cancel while an install runs', async () => {
        vi.mocked(tauriService.installVersion).mockReturnValueOnce(new Promise(() => {}));
        const { container } = render(<VersionsTab />);
        await screen.findByText('2.0.18');
        fireEvent.click(within(rowOf('2.0.18')).getByRole('button', { name: /Switch to v2\.0\.18/ }));

        // The running row says what it is doing; the others are locked out.
        expect(await within(rowOf('2.0.18')).findByText('Installing…')).toBeTruthy();
        const other = within(rowOf('2.2.0')).getByRole('button', {
            name: /Switch to v2\.2\.0/,
        }) as HTMLButtonElement;
        expect(other.disabled).toBe(true);

        const cancel = within(
            container.querySelector('.versions-actions') as HTMLElement,
        ).getByText('Cancel');
        fireEvent.click(cancel);
        expect(tauriService.cancelVersionInstall).toHaveBeenCalled();
    });

    it('reports download progress', async () => {
        render(<VersionsTab />);
        await screen.findByText('2.0.18');
        await waitFor(() => expect(progressCb).not.toBeNull());

        act(() => {
            progressCb?.({
                tag: 'v2.0.18',
                phase: 'downloading',
                downloaded: 3_250_000,
                total: 6_500_000,
            });
        });
        expect(screen.getByText(/Downloading.* 50%/)).toBeTruthy();

        act(() => {
            progressCb?.({ tag: 'v2.0.18', phase: 'verifying', downloaded: 1, total: 1 });
        });
        expect(screen.getByText(/Verifying checksum/)).toBeTruthy();
    });

    it('surfaces a failed switch instead of failing silently', async () => {
        vi.mocked(tauriService.installVersion).mockRejectedValueOnce(
            new Error('checksum mismatch'),
        );
        render(<VersionsTab />);
        await screen.findByText('2.0.18');
        fireEvent.click(within(rowOf('2.0.18')).getByRole('button', { name: /Switch to v2\.0\.18/ }));
        expect(await screen.findByText(/checksum mismatch/)).toBeTruthy();
    });

    it('shows an error when the release list cannot be loaded', async () => {
        vi.mocked(tauriService.listReleases).mockRejectedValueOnce(new Error('rate limit reached'));
        render(<VersionsTab />);
        expect(await screen.findByText(/rate limit reached/)).toBeTruthy();
        expect(screen.getByText('No releases found')).toBeTruthy();
    });
});
