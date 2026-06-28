import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThirdPartyLicensesModal } from './ThirdPartyLicensesModal';
import { tauriService } from '../../services/tauriService';
import type { ThirdPartyLicenses } from '../../types/appTypes';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    getThirdPartyLicenses: vi.fn(),
    openExternal: vi.fn(),
  },
}));

const manifest: ThirdPartyLicenses = {
  generatedAt: '2026-06-29T00:00:00.000Z',
  counts: { npm: 1, rust: 1, total: 2 },
  packages: [
    { name: 'react', version: '19.2.4', ecosystem: 'npm', license: 'MIT', repository: 'https://github.com/facebook/react', licenseText: 'MIT License text' },
    { name: 'serde', version: '1.0.0', ecosystem: 'rust', license: 'MIT OR Apache-2.0' },
  ],
};

describe('ThirdPartyLicensesModal', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists packages after loading the manifest', async () => {
    vi.mocked(tauriService.getThirdPartyLicenses).mockResolvedValue(manifest);
    render(<ThirdPartyLicensesModal onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('react')).toBeTruthy());
    expect(screen.getByText('serde')).toBeTruthy();
    expect(screen.getByText('MIT OR Apache-2.0')).toBeTruthy();
  });

  it('shows the empty state when no packages are returned', async () => {
    vi.mocked(tauriService.getThirdPartyLicenses).mockResolvedValue({ packages: [] });
    render(<ThirdPartyLicensesModal onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('No third-party license information is available.')).toBeTruthy(),
    );
  });

  it('shows the error state when loading fails', async () => {
    vi.mocked(tauriService.getThirdPartyLicenses).mockRejectedValue(new Error('boom'));
    render(<ThirdPartyLicensesModal onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('Failed to load license information.')).toBeTruthy(),
    );
  });

  it('Close button triggers onClose', async () => {
    vi.mocked(tauriService.getThirdPartyLicenses).mockResolvedValue({ packages: [] });
    const onClose = vi.fn();
    render(<ThirdPartyLicensesModal onClose={onClose} />);
    await waitFor(() => screen.getByText('Close'));
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
