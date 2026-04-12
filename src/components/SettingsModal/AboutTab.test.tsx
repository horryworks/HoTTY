import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AboutTab } from './AboutTab';

const mockGetAppVersion = vi.fn().mockResolvedValue('0.1.1');
const mockOpenExternal = vi.fn().mockResolvedValue(undefined);

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    getAppVersion: (...args: unknown[]) => mockGetAppVersion(...args),
    openExternal: (...args: unknown[]) => mockOpenExternal(...args),
  },
}));

describe('AboutTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the app logo, name, author, and description', () => {
    render(<AboutTab />);
    const logo = screen.getByAltText('HoTTY Logo') as HTMLImageElement;
    expect(logo).toBeTruthy();
    expect(logo.width).toBe(64);
    expect(screen.getByText('HoTTY')).toBeTruthy();
    expect(screen.getByText(/Katsumasa/)).toBeTruthy();
    expect(screen.getByText(/SSH\/Telnet\/Serial Terminal Emulator/)).toBeTruthy();
    expect(screen.getByText(/GNU General Public License v3.0 or later/)).toBeTruthy();
  });

  it('displays the version after loading', async () => {
    render(<AboutTab />);
    await waitFor(() => {
      expect(screen.getByText('v0.1.1')).toBeTruthy();
    });
    expect(mockGetAppVersion).toHaveBeenCalledTimes(1);
  });

  it('opens the GitHub link via tauriService.openExternal', () => {
    render(<AboutTab />);
    const ghLink = screen.getByText('https://github.com/horryworks/HoTTY-Rust-Tauri');
    fireEvent.click(ghLink);
    expect(mockOpenExternal).toHaveBeenCalledWith(
      'https://github.com/horryworks/HoTTY-Rust-Tauri'
    );
  });

  it('opens the license link via tauriService.openExternal', () => {
    render(<AboutTab />);
    const licenseLink = screen.getByText('View GNU General Public License v3.0');
    fireEvent.click(licenseLink);
    expect(mockOpenExternal).toHaveBeenCalledWith(
      'https://www.gnu.org/licenses/gpl-3.0.html'
    );
  });
});
