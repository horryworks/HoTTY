import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from './SettingsModal';
import { useSettingsStore } from '../../stores/settingsStore';
import { DEFAULT_THEMES } from '../../themes/defaults';

const themeProps = {
  themesData: DEFAULT_THEMES as Record<string, (typeof DEFAULT_THEMES)['dark']>,
  onOpenCustomThemeCreator: () => {},
  onDeleteTheme: async () => {},
};

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    getAppVersion: vi.fn().mockResolvedValue('0.1.1'),
    openExternal: vi.fn().mockResolvedValue(undefined),
    selectFolder: vi.fn().mockResolvedValue(null),
    openDebugLogFolder: vi.fn().mockResolvedValue(undefined),
    listSystemFonts: vi.fn().mockResolvedValue([]),
    getSshAlgorithms: vi.fn().mockResolvedValue({}),
    saveSshAlgorithms: vi.fn().mockResolvedValue(true),
  },
}));

describe('SettingsModal', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it('renders nothing when open=false', () => {
    const { container } = render(<SettingsModal open={false} onClose={() => {}} {...themeProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the General tab by default', () => {
    render(<SettingsModal open onClose={() => {}} {...themeProps} />);
    expect(screen.getByText('Logging')).toBeTruthy();
    expect(screen.getByText('Terminal')).toBeTruthy();
    expect(screen.getByText('Input')).toBeTruthy();
    expect(screen.getByText('Diagnostics')).toBeTruthy();
  });

  it('switches to the Appearance tab', () => {
    render(<SettingsModal open onClose={() => {}} {...themeProps} />);
    fireEvent.click(screen.getByText('Appearance'));
    expect(screen.getByText('Font family')).toBeTruthy();
  });

  it('switches to the Protocols tab', () => {
    render(<SettingsModal open onClose={() => {}} {...themeProps} />);
    fireEvent.click(screen.getByText('Protocols'));
    expect(screen.getByText('SSH')).toBeTruthy();
    expect(screen.getByText('Telnet')).toBeTruthy();
  });

  it('switches to the Features tab', () => {
    render(<SettingsModal open onClose={() => {}} {...themeProps} />);
    fireEvent.click(screen.getByText('Features'));
    expect(screen.getByText('AI Chat')).toBeTruthy();
    expect(screen.getByText('Log Viewer')).toBeTruthy();
  });

  it('switches to the About tab and renders app name', () => {
    render(<SettingsModal open onClose={() => {}} {...themeProps} />);
    fireEvent.click(screen.getByText('About'));
    expect(screen.getByText('HoTTY')).toBeTruthy();
  });

  it('clicking the overlay triggers onClose; clicking the modal body does not', () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal open onClose={onClose} {...themeProps} />);
    const overlay = container.querySelector('.settings-modal-overlay') as HTMLElement;
    const modal = container.querySelector('.settings-modal') as HTMLElement;

    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens on the requested tab via initialTab (deep link)', () => {
    render(<SettingsModal open onClose={() => {}} {...themeProps} initialTab="ai" />);
    expect(screen.getByText('AI Provider')).toBeTruthy();
  });

  it('renders all 5 tab buttons', () => {
    render(<SettingsModal open onClose={() => {}} {...themeProps} />);
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByText('Protocols')).toBeTruthy();
    expect(screen.getByText('Features')).toBeTruthy();
    expect(screen.getByText('About')).toBeTruthy();
  });
});
