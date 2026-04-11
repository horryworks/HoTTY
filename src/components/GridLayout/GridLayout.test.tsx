import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { GridLayout } from './GridLayout';
import type { Session } from '../../hooks/useSessionManager';

vi.mock('./GridLayout.css', () => ({}));
vi.mock('../Terminal/Terminal', () => ({
    TerminalComponent: () => <div data-testid="terminal" />,
}));
vi.mock('../AIChatPane/AIChatPane', () => ({
    AIChatPane: () => <div data-testid="ai-chat" />,
}));
vi.mock('../LogViewerPane/LogViewerPane', () => ({
    LogViewerPane: () => <div data-testid="log-viewer" />,
}));
vi.mock('../PaneContent/PaneContent', () => ({
    PaneContent: () => <div data-testid="pane-content" />,
}));
vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: vi.fn((selector?: (s: unknown) => unknown) => {
        const state = {
            fontSize: 14,
            fontFamily: 'Consolas',
            terminalForeground: '#fff',
            terminalBackground: '#000',
            terminalBackgroundInactive: '#111',
            lineWrapEnabled: true,
            scrollback: 1000,
            backspaceSendsDel: false,
            rightClickPaste: false,
            showSystemPrompt: false,
            enablePromptHighlight: false,
            promptHighlightColor: '#ff0',
            promptPatterns: [],
            aiPersonas: [],
            activePersonaId: 'network-expert',
            sidebarPosition: 'right',
            interactiveStabilizationTimeout: 400,
        };
        return typeof selector === 'function' ? selector(state) : state;
    }),
}));

const baseProps = {
    rows: 1,
    cols: 1,
    sessions: [] as Session[],
    updateSessionState: vi.fn(),
    paneAllocations: { '0': null } as { [paneId: string]: string | null },
    activePaneId: null,
    onPaneClick: vi.fn(),
    onDropSession: vi.fn(),
    onData: vi.fn(),
    focusTrigger: 0,
    paneBackground: null,
    paneBackgroundMode: 'color' as const,
    paneBackgroundImage: null,
    terminalRegistry: {} as Record<string, never>,
};

describe('GridLayout', () => {
    it('renders a 1x1 grid without crashing', () => {
        const { container } = render(<GridLayout {...baseProps} />);
        expect(container).toBeTruthy();
    });

    it('renders a 2x2 grid without crashing', () => {
        const { container } = render(
            <GridLayout
                {...baseProps}
                rows={2}
                cols={2}
                paneAllocations={{ '0': null, '1': null, '2': null, '3': null }}
            />
        );
        expect(container).toBeTruthy();
    });

    it('renders with a session allocated to a pane', () => {
        const session: Session = { id: 's1', title: 'SSH Host', type: 'ssh' };
        const { container } = render(
            <GridLayout
                {...baseProps}
                sessions={[session]}
                paneAllocations={{ '0': 's1' }}
            />
        );
        expect(container).toBeTruthy();
    });

    it('renders with activePaneId set', () => {
        const { container } = render(
            <GridLayout
                {...baseProps}
                activePaneId="0"
                paneAllocations={{ '0': null }}
            />
        );
        expect(container).toBeTruthy();
    });

    it('renders a 3x1 grid without crashing', () => {
        const { container } = render(
            <GridLayout
                {...baseProps}
                rows={1}
                cols={3}
                paneAllocations={{ '0': null, '1': null, '2': null }}
            />
        );
        expect(container).toBeTruthy();
    });
});
