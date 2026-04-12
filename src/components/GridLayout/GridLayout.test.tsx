import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GridLayout } from './GridLayout';
import { usePaneStore } from '../../stores/paneStore';

describe('GridLayout', () => {
  beforeEach(() => {
    usePaneStore.setState({ layoutMode: '2x2' });
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

  it('sets grid-template columns/rows from the layout mode', () => {
    usePaneStore.setState({ layoutMode: '2x3' });
    const { container } = render(
      <GridLayout renderPane={() => null} onDropSession={() => {}} />
    );
    const grid = container.querySelector('.grid-layout') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(3, 1fr)');
    expect(grid.style.gridTemplateRows).toBe('repeat(2, 1fr)');
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
});
