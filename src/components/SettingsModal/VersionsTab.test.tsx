import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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
    entry({
        version: '2.1.0-beta1',
        prerelease: true,
        relation: 'current',
        notes: '## Beta build\n\n- worker sessions',
    }),
    entry({ version: '2.0.18', notes: '## Stable build\n\n- markdown links fixed' }),
    entry({ version: '2.0.17', installable: false }),
];

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

    it('does not warn when reinstalling the current version', async () => {
        render(<VersionsTab />);
        fireEvent.click(await screen.findByText('2.1.0-beta1'));
        expect(screen.queryByText(/saved credentials are kept/)).toBeNull();
        expect(await screen.findByText(/Reinstall v2\.1\.0-beta1/)).toBeTruthy();
    });

    it('sends only a tag and a language to the backend, never a URL', async () => {
        render(<VersionsTab />);
        fireEvent.click(await screen.findByText('2.0.18'));
        fireEvent.click(await screen.findByText(/Switch to v2\.0\.18/));

        await waitFor(() => expect(tauriService.installVersion).toHaveBeenCalled());
        // The security contract: the renderer picks a tag, the backend resolves
        // it. If a URL ever shows up in this call, that guarantee is gone.
        expect(tauriService.installVersion).toHaveBeenCalledWith('v2.0.18', 'en');
        const args = vi.mocked(tauriService.installVersion).mock.calls[0];
        expect(JSON.stringify(args)).not.toContain('http');
    });

    it('refuses to install a release with no published checksum', async () => {
        render(<VersionsTab />);
        fireEvent.click(await screen.findByText('2.0.17'));
        const button = (await screen.findByText(/Switch to v2\.0\.17/)).closest(
            'button',
        ) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
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
        fireEvent.click(await screen.findByText('2.0.18'));
        fireEvent.click(await screen.findByText(/Switch to v2\.0\.18/));
        expect(await screen.findByText(/checksum mismatch/)).toBeTruthy();
    });

    it('shows an error when the release list cannot be loaded', async () => {
        vi.mocked(tauriService.listReleases).mockRejectedValueOnce(new Error('rate limit reached'));
        render(<VersionsTab />);
        expect(await screen.findByText(/rate limit reached/)).toBeTruthy();
        expect(screen.getByText('No releases found')).toBeTruthy();
    });
});
