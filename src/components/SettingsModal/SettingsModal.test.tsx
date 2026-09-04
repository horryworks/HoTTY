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

  it('renders every tab button', () => {
    render(<SettingsModal open onClose={() => {}} {...themeProps} />);
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByText('Protocols')).toBeTruthy();
    expect(screen.getByText('Features')).toBeTruthy();
    expect(screen.getByText('Versions')).toBeTruthy();
    expect(screen.getByText('About')).toBeTruthy();
  });

  describe('resizing', () => {
    const grip = () => document.querySelector('.settings-modal-resize') as HTMLElement;
    const dialog = () => document.querySelector('.settings-modal') as HTMLElement;

    /** jsdom computes no layout, so the starting size has to be supplied. */
    function openAt(w: number, h: number) {
      render(<SettingsModal open onClose={() => {}} {...themeProps} />);
      const el = dialog();
      Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true });
      Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true });
      return el;
    }

    it('applies a stored size on open', () => {
      useSettingsStore.getState().update('settingsModalWidth', 700);
      useSettingsStore.getState().update('settingsModalHeight', 640);
      render(<SettingsModal open onClose={() => {}} {...themeProps} />);
      expect(dialog().style.width).toBe('700px');
      expect(dialog().style.height).toBe('640px');
    });

    it('resizes during the drag but only persists on release', () => {
      const el = openAt(520, 600);

      fireEvent.mouseDown(grip(), { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(document, { clientX: 180, clientY: 160 });
      expect(el.style.width).toBe('600px');
      expect(el.style.height).toBe('660px');
      // Still unsaved: persisting per frame would rewrite the whole settings
      // blob to localStorage on every mousemove.
      expect(useSettingsStore.getState().settingsModalWidth).toBeNull();

      fireEvent.mouseUp(document);
      expect(useSettingsStore.getState().settingsModalWidth).toBe(600);
      expect(useSettingsStore.getState().settingsModalHeight).toBe(660);
    });

    it('will not shrink past a usable size', () => {
      const el = openAt(520, 600);
      fireEvent.mouseDown(grip(), { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(document, { clientX: -500, clientY: -500 });
      // Any narrower and the tab strip is more arrows than tabs.
      expect(el.style.width).toBe('420px');
      expect(el.style.height).toBe('320px');
      fireEvent.mouseUp(document);
    });

    it('returns to the stylesheet size on double-click', () => {
      useSettingsStore.getState().update('settingsModalWidth', 700);
      useSettingsStore.getState().update('settingsModalHeight', 640);
      render(<SettingsModal open onClose={() => {}} {...themeProps} />);
      expect(dialog().style.width).toBe('700px');

      fireEvent.doubleClick(grip());
      expect(useSettingsStore.getState().settingsModalWidth).toBeNull();
      expect(useSettingsStore.getState().settingsModalHeight).toBeNull();
      // The inline style has to go too: the drag wrote it straight to the node,
      // so clearing the stored value alone would leave the dialog resized.
      expect(dialog().style.width).toBe('');
      expect(dialog().style.height).toBe('');
    });

    it('keeps its height when the tab changes', () => {
      useSettingsStore.getState().update('settingsModalHeight', 640);
      render(<SettingsModal open onClose={() => {}} {...themeProps} />);
      const before = dialog().style.height;
      fireEvent.click(screen.getByText('About'));
      // The dialog used to size to its content, so every tab change resized it.
      expect(dialog().style.height).toBe(before);
    });
  });
});
