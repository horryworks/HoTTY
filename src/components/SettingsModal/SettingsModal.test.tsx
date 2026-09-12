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
  it('does not close when the backdrop is clicked; the close button does', () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal open onClose={onClose} {...themeProps} />);
    const overlay = container.querySelector('.dlg-overlay') as HTMLElement;

    // Settings holds forms across nine tabs. A stray click on the backdrop used
    // to throw all of that away, so the way out is now explicit: the close
    // button, Escape, or a tab's own Cancel.
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Close'));
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
    expect(screen.getByText('SSH Keys')).toBeTruthy();
    expect(screen.getByText('Features')).toBeTruthy();
    expect(screen.getByText('Versions')).toBeTruthy();
    expect(screen.getByText('About')).toBeTruthy();
  });

  describe('geometry', () => {
    const grip = () => document.querySelector('.drf-se') as HTMLElement;
    const dialog = () => document.querySelector('.settings-modal') as HTMLElement;
    const storedSize = () => useSettingsStore.getState().dialogSizes.settings;

    /** Press the grip, move, release. Geometry is driven by pointer events. */
    function dragGrip(dx: number, dy: number, release = true) {
      fireEvent.pointerDown(grip(), { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
      if (release) fireEvent.pointerUp(window, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
    }

    it('opens at the default size', () => {
      render(<SettingsModal open onClose={() => {}} {...themeProps} />);
      expect(dialog().style.width).toBe('520px');
      expect(dialog().style.height).toBe('600px');
    });

    it('applies a stored size on open', () => {
      useSettingsStore.getState().update('dialogSizes', { settings: { width: 700, height: 640 } });
      render(<SettingsModal open onClose={() => {}} {...themeProps} />);
      expect(dialog().style.width).toBe('700px');
      expect(dialog().style.height).toBe('640px');
    });

    it('resizes during the drag but only persists on release', () => {
      render(<SettingsModal open onClose={() => {}} {...themeProps} />);

      dragGrip(80, 60, false);
      expect(dialog().style.width).toBe('600px');
      expect(dialog().style.height).toBe('660px');
      // Still unsaved: persisting per frame would rewrite the whole settings
      // blob to localStorage on every pointer move.
      expect(storedSize()).toBeUndefined();

      fireEvent.pointerUp(window, { clientX: 180, clientY: 160, pointerId: 1 });
      expect(storedSize()).toEqual({ width: 600, height: 660 });
    });

    it('will not shrink past a usable size', () => {
      render(<SettingsModal open onClose={() => {}} {...themeProps} />);
      dragGrip(-500, -500);
      // Any narrower and the tab strip is more arrows than tabs.
      expect(dialog().style.width).toBe('420px');
      expect(dialog().style.height).toBe('320px');
    });

    it('leaves the top-left corner alone while the bottom-right is dragged', () => {
      render(<SettingsModal open onClose={() => {}} {...themeProps} />);
      const before = { left: dialog().style.left, top: dialog().style.top };

      dragGrip(120, 90);

      expect(dialog().style.left).toBe(before.left);
      expect(dialog().style.top).toBe(before.top);
    });

    it('returns to the default size on double-click, and forgets the stored one', () => {
      useSettingsStore.getState().update('dialogSizes', { settings: { width: 700, height: 640 } });
      render(<SettingsModal open onClose={() => {}} {...themeProps} />);
      expect(dialog().style.width).toBe('700px');

      fireEvent.doubleClick(grip());

      expect(dialog().style.width).toBe('520px');
      expect(dialog().style.height).toBe('600px');
      // The key is dropped rather than set to the default, so a later change to
      // the default still reaches anyone who never resized the dialog.
      expect(storedSize()).toBeUndefined();
    });

    it('keeps its height when the tab changes', () => {
      useSettingsStore.getState().update('dialogSizes', { settings: { width: 520, height: 640 } });
      render(<SettingsModal open onClose={() => {}} {...themeProps} />);
      const before = dialog().style.height;
      fireEvent.click(screen.getByText('About'));
      // The dialog used to size to its content, so every tab change resized it.
      expect(dialog().style.height).toBe(before);
    });

    it('does not close when a resize drag is released on the overlay', () => {
      const onClose = vi.fn();
      const { container } = render(<SettingsModal open onClose={onClose} {...themeProps} />);
      const overlay = container.querySelector('.dlg-overlay') as HTMLElement;

      // Drag the grip out past the dialog and let go: the browser fires the
      // click at the common ancestor of press and release, which is the
      // overlay. Before the press was checked too, that closed the dialog
      // mid-resize.
      fireEvent.mouseDown(grip(), { clientX: 100, clientY: 100 });
      fireEvent.mouseUp(document, { clientX: 900, clientY: 900 });
      fireEvent.click(overlay);

      expect(onClose).not.toHaveBeenCalled();
    });

    it('offers a grab area on every edge and corner', () => {
      const { container } = render(<SettingsModal open onClose={() => {}} {...themeProps} />);
      expect(container.querySelectorAll('.drf-edge')).toHaveLength(8);
    });
  });
});
