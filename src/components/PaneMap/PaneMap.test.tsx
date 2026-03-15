import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaneMap } from './PaneMap';

vi.mock('./PaneMap.css', () => ({}));

describe('PaneMap', () => {
    it('returns null when sessions is empty', () => {
        const { container } = render(
            <PaneMap
                sessions={[]}
                tabOrder={[]}
                paneAllocations={{}}
                activePaneId={null}
                totalPanes={1}
            />
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders "Map" label when sessions exist', () => {
        render(
            <PaneMap
                sessions={[{ id: 's1', title: 'Session 1' }]}
                tabOrder={['s1']}
                paneAllocations={{ '0': 's1' }}
                activePaneId={null}
                totalPanes={1}
            />
        );
        expect(screen.getByText('Map')).toBeInTheDocument();
    });

    it('shows tab numbers in order', () => {
        render(
            <PaneMap
                sessions={[
                    { id: 's1', title: 'Session 1' },
                    { id: 's2', title: 'Session 2' },
                ]}
                tabOrder={['s1', 's2']}
                paneAllocations={{ '0': 's1', '1': 's2' }}
                activePaneId={null}
                totalPanes={2}
            />
        );
        const tabNums = document.querySelectorAll('.map-tab-num');
        expect(tabNums[0].textContent).toBe('1');
        expect(tabNums[1].textContent).toBe('2');
    });

    it('shows → arrow for visible sessions', () => {
        render(
            <PaneMap
                sessions={[{ id: 's1', title: 'Session 1' }]}
                tabOrder={['s1']}
                paneAllocations={{ '0': 's1' }}
                activePaneId={null}
                totalPanes={1}
            />
        );
        expect(screen.getByText('→')).toBeInTheDocument();
    });

    it('shows × for sessions not allocated to a pane', () => {
        render(
            <PaneMap
                sessions={[{ id: 's1', title: 'Session 1' }]}
                tabOrder={['s1']}
                paneAllocations={{}}
                activePaneId={null}
                totalPanes={1}
            />
        );
        expect(screen.getByText('×')).toBeInTheDocument();
    });

    it('session not in paneAllocations shows "-" and has hidden-item class', () => {
        const { container } = render(
            <PaneMap
                sessions={[{ id: 's1', title: 'Session 1' }]}
                tabOrder={['s1']}
                paneAllocations={{}}
                activePaneId={null}
                totalPanes={1}
            />
        );
        expect(screen.getByText('-')).toBeInTheDocument();
        expect(container.querySelector('.hidden-item')).toBeInTheDocument();
    });

    it('session allocated to pane 0 shows pane number "1"', () => {
        render(
            <PaneMap
                sessions={[{ id: 's1', title: 'Session 1' }]}
                tabOrder={['s1']}
                paneAllocations={{ '0': 's1' }}
                activePaneId={null}
                totalPanes={1}
            />
        );
        const paneNum = document.querySelector('.map-pane-num');
        expect(paneNum?.textContent).toBe('1');
    });

    it('active pane session has "active" class', () => {
        const { container } = render(
            <PaneMap
                sessions={[{ id: 's1', title: 'Session 1' }]}
                tabOrder={['s1']}
                paneAllocations={{ '0': 's1' }}
                activePaneId={'0'}
                totalPanes={1}
            />
        );
        expect(container.querySelector('.pane-map-item.active')).toBeInTheDocument();
    });
});
