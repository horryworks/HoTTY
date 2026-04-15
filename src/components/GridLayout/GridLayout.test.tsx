import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GridLayout } from './GridLayout';
import { usePaneStore } from '../../stores/paneStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { STORAGE_KEYS } from '../../constants/storage';

describe('GridLayout', () => {
  beforeEach(() => {
    usePaneStore.setState({ layoutMode: '2x2' });
    useSettingsStore.getState().reset();
    localStorage.clear();
  });

  it('renders one cell per pane id for the current layout mode', () => {
    const { container } = render(
      <GridLayout renderPane={(id) => <span>pane-{id}</span>} onDropSession={() => {}} />
    );
    const cells = container.querySelectorAll('.grid-layout-cell');
    expect(cells.length).toBe(4);
    expect(screen.getByText('pane-0')).toBeTruthy();
    expect(screen.getByText('pane-3')).toBeTruthy();
  });

  it('builds grid-template with fr tracks interleaved with 4px resizer tracks', () => {
    usePaneStore.setState({ layoutMode: '2x3' });
    const { container } = render(
      <GridLayout renderPane={() => null} onDropSession={() => {}} />
    );
    const grid = container.querySelector('.grid-layout') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe(
      'minmax(0, 1fr) 4px minmax(0, 1fr) 4px minmax(0, 1fr)'
    );
    expect(grid.style.gridTemplateRows).toBe('minmax(0, 1fr) 4px minmax(0, 1fr)');
  });

  it('renders V/H/cross resizers for a 2x2 layout', () => {
    const { container } = render(
      <GridLayout renderPane={() => null} onDropSession={() => {}} />
    );
    expect(container.querySelectorAll('.grid-resizer-v').length).toBe(1);
    expect(container.querySelectorAll('.grid-resizer-h').length).toBe(1);
    expect(container.querySelectorAll('.grid-resizer-cross').length).toBe(1);
  });

  it('applies paneBackground color as inline backgroundColor on every cell', () => {
    useSettingsStore.getState().update('paneBackground', '#112233');
    useSettingsStore.getState().update('paneBackgroundMode', 'color');
    const { container } = render(
      <GridLayout renderPane={() => null} onDropSession={() => {}} />
    );
    const cells = container.querySelectorAll('.grid-layout-cell');
    cells.forEach((c) => {
      expect((c as HTMLElement).style.backgroundColor).toBe('rgb(17, 34, 51)');
      expect((c as HTMLElement).style.backgroundImage).toBe('none');
    });
  });

  it('applies backgroundImage url when mode is image and image is set', () => {
    useSettingsStore.getState().update('paneBackgroundMode', 'image');
    useSettingsStore.getState().update('paneBackgroundImage', 'http://asset.localhost/foo.png');
    const { container } = render(
      <GridLayout renderPane={() => null} onDropSession={() => {}} />
    );
    const cell = container.querySelector('.grid-layout-cell') as HTMLElement;
    expect(cell.style.backgroundImage).toContain('http://asset.localhost/foo.png');
  });

  it('calls onDropSession with the session id and pane id on drop', () => {
    const onDropSession = vi.fn();
    const { container } = render(
      <GridLayout renderPane={() => null} onDropSession={onDropSession} />
    );
    const firstCell = container.querySelector('.grid-layout-cell') as HTMLElement;
    const dataTransfer = {
      types: ['application/x-hotty-session'],
      getData: (type: string) =>
        type === 'application/x-hotty-session' ? 'sess-1' : '',
      dropEffect: '',
    };
    fireEvent.dragOver(firstCell, { dataTransfer });
    fireEvent.drop(firstCell, { dataTransfer });
    expect(onDropSession).toHaveBeenCalledWith('sess-1', '0');
  });

  it('ignores drops that do not carry a session id', () => {
    const onDropSession = vi.fn();
    const { container } = render(
      <GridLayout renderPane={() => null} onDropSession={onDropSession} />
    );
    const firstCell = container.querySelector('.grid-layout-cell') as HTMLElement;
    fireEvent.drop(firstCell, {
      dataTransfer: {
        types: [],
        getData: () => '',
        dropEffect: '',
      },
    });
    expect(onDropSession).not.toHaveBeenCalled();
  });

  it('dragging the vertical resizer shifts column fr weights and persists them', () => {
    const rafCb: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        rafCb.push(cb);
        return rafCb.length as unknown as number;
      });

    const { container, unmount } = render(
      <GridLayout renderPane={() => null} onDropSession={() => {}} />
    );
    const grid = container.querySelector('.grid-layout') as HTMLElement;
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 400,
      bottom: 400,
      width: 400,
      height: 400,
      toJSON: () => ({}),
    } as DOMRect);

    const vResizer = container.querySelector('.grid-resizer-v') as HTMLElement;
    fireEvent.mouseDown(vResizer, { clientX: 200, clientY: 200, button: 0 });
    expect(document.body.style.cursor).toBe('col-resize');

    fireEvent(
      document,
      new MouseEvent('mousemove', { clientX: 300, clientY: 200, bubbles: true })
    );
    act(() => {
      while (rafCb.length) rafCb.shift()!(performance.now());
    });

    const colTemplate = grid.style.gridTemplateColumns;
    const frMatches = Array.from(colTemplate.matchAll(/minmax\(0, ([\d.]+)fr\)/g)).map(
      (m) => parseFloat(m[1])
    );
    expect(frMatches.length).toBe(2);
    expect(frMatches[0]).toBeGreaterThan(1);
    expect(frMatches[1]).toBeLessThan(1);
    expect(Math.abs(frMatches[0] + frMatches[1] - 2)).toBeLessThan(1e-6);

    fireEvent(document, new MouseEvent('mouseup', { bubbles: true }));
    expect(document.body.style.cursor).toBe('');

    const saved = localStorage.getItem(STORAGE_KEYS.UI_GRID_COL_SIZES(2));
    expect(saved).not.toBeNull();
    const savedArr = JSON.parse(saved!) as number[];
    expect(savedArr).toHaveLength(2);
    expect(savedArr[0]).toBeGreaterThan(1);

    rafSpy.mockRestore();
    unmount();
  });

  it('restores saved column sizes for the current layout mode on mount', () => {
    localStorage.setItem(STORAGE_KEYS.UI_GRID_COL_SIZES(2), JSON.stringify([1.5, 0.5]));
    const { container } = render(
      <GridLayout renderPane={() => null} onDropSession={() => {}} />
    );
    const grid = container.querySelector('.grid-layout') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('minmax(0, 1.5fr) 4px minmax(0, 0.5fr)');
  });

  it('clamps a drag past the minimum to 0.1fr, absorbing the rest into the sibling', () => {
    const rafCb: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCb.push(cb);
      return rafCb.length as unknown as number;
    });

    const { container } = render(
      <GridLayout renderPane={() => null} onDropSession={() => {}} />
    );
    const grid = container.querySelector('.grid-layout') as HTMLElement;
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 400,
      width: 400, height: 400, toJSON: () => ({}),
    } as DOMRect);

    const vResizer = container.querySelector('.grid-resizer-v') as HTMLElement;
    fireEvent.mouseDown(vResizer, { clientX: 200, clientY: 200, button: 0 });
    fireEvent(
      document,
      new MouseEvent('mousemove', { clientX: 10000, clientY: 200, bubbles: true })
    );
    act(() => {
      while (rafCb.length) rafCb.shift()!(performance.now());
    });
    fireEvent(document, new MouseEvent('mouseup', { bubbles: true }));

    const frMatches = Array.from(
      grid.style.gridTemplateColumns.matchAll(/minmax\(0, ([\d.]+)fr\)/g)
    ).map((m) => parseFloat(m[1]));
    expect(frMatches[1]).toBeCloseTo(0.1, 5);
    expect(frMatches[0]).toBeCloseTo(1.9, 5);
  });
});
