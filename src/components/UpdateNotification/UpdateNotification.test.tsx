import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { UpdateNotification } from './UpdateNotification';
import { tauriService } from '../../services/tauriService';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    checkForUpdates: vi.fn(),
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));

const onOpenVersions = vi.fn();

const sampleInfo = {
  currentVersion: '2.0.0-beta3',
  latestVersion: '2.0.0',
  releaseName: 'v2.0.0',
  releaseUrl: 'https://example.test/release',
  prerelease: false,
  notes: 'release notes',
  isNewer: true,
};

describe('UpdateNotification', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders nothing when no update is available', async () => {
    vi.mocked(tauriService.checkForUpdates).mockResolvedValueOnce(null);
    const { container } = render(<UpdateNotification onOpenVersions={onOpenVersions} />);
    await waitFor(() => {
      expect(tauriService.checkForUpdates).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
  });

  it('shows the banner when an update is available', async () => {
    vi.mocked(tauriService.checkForUpdates).mockResolvedValueOnce(sampleInfo);
    render(<UpdateNotification onOpenVersions={onOpenVersions} />);
    expect(await screen.findByText(/New version available: v2\.0\.0/)).toBeTruthy();
    expect(screen.getByText(/You are running v2\.0\.0-beta3/)).toBeTruthy();
  });

  it('opens the in-app version switcher rather than the browser', async () => {
    vi.mocked(tauriService.checkForUpdates).mockResolvedValueOnce(sampleInfo);
    render(<UpdateNotification onOpenVersions={onOpenVersions} />);
    const btn = await screen.findByText('Switch version');
    fireEvent.click(btn);
    expect(onOpenVersions).toHaveBeenCalled();
    // The point of the change: updating no longer sends the user out to
    // GitHub, so nothing here may reach for the browser.
    expect(tauriService.openExternal).not.toHaveBeenCalled();
  });

  it('hides and persists dismissal when Dismiss is clicked', async () => {
    vi.mocked(tauriService.checkForUpdates).mockResolvedValueOnce(sampleInfo);
    const { container } = render(<UpdateNotification onOpenVersions={onOpenVersions} />);
    const btn = await screen.findByText('Dismiss');
    fireEvent.click(btn);
    expect(container.firstChild).toBeNull();
    expect(localStorage.getItem('hotty:update-dismissed-version')).toBe('2.0.0');
  });

  it('does not show the banner for a previously dismissed version', async () => {
    localStorage.setItem('hotty:update-dismissed-version', '2.0.0');
    vi.mocked(tauriService.checkForUpdates).mockResolvedValueOnce(sampleInfo);
    const { container } = render(<UpdateNotification onOpenVersions={onOpenVersions} />);
    await waitFor(() => {
      expect(tauriService.checkForUpdates).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
  });

  it('swallows errors silently', async () => {
    vi.mocked(tauriService.checkForUpdates).mockRejectedValueOnce(new Error('net down'));
    const { container } = render(<UpdateNotification onOpenVersions={onOpenVersions} />);
    await waitFor(() => {
      expect(tauriService.checkForUpdates).toHaveBeenCalled();
    });
    expect(container.firstChild).toBeNull();
  });
});
