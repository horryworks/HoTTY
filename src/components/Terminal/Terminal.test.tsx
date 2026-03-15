import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { TerminalComponentBase } from './Terminal';

// jsdom does not implement ResizeObserver — provide a class-based stub
class MockResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
}

beforeAll(() => {
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('./Terminal.css', () => ({}));
vi.mock('../../utils/colorUtils', () => ({
    getTransparentColor: vi.fn((c: string) => c),
}));

const mockTerminal = {
    open: vi.fn(),
    write: vi.fn(),
    loadAddon: vi.fn(),
    onSelectionChange: vi.fn(),
    attachCustomKeyEventHandler: vi.fn(),
    onData: vi.fn(),
    onCursorMove: vi.fn(() => ({ dispose: vi.fn() })),
    onLineFeed: vi.fn(() => ({ dispose: vi.fn() })),
    onRender: vi.fn(() => ({ dispose: vi.fn() })),
    getSelection: vi.fn(() => ''),
    hasSelection: vi.fn(() => false),
    getSelectionPosition: vi.fn(() => null),
    focus: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    refresh: vi.fn(),
    scrollToBottom: vi.fn(),
    registerMarker: vi.fn(() => null),
    registerDecoration: vi.fn(() => null),
    selectLines: vi.fn(),
    cols: 80,
    rows: 24,
    options: { scrollback: 1000 },
    element: null,
    buffer: {
        active: {
            baseY: 0,
            cursorY: 0,
            viewportY: 0,
            length: 0,
            getLine: vi.fn(() => null),
        },
    },
};

vi.mock('@xterm/xterm', () => ({
    Terminal: vi.fn(() => mockTerminal),
}));
vi.mock('@xterm/addon-fit', () => ({
    FitAddon: vi.fn(() => ({
        fit: vi.fn(),
        proposeDimensions: vi.fn(() => null),
    })),
}));
vi.mock('../../services/electronService', () => ({
    showContextMenu: vi.fn(),
    onTerminalContextPaste: vi.fn(() => vi.fn()),
    logDebug: vi.fn(),
    resize: vi.fn(),
}));

const baseProps = {
    sessionId: 'test-session',
    isActive: true,
    focusTrigger: 0,
    disableFocus: false,
    fontSize: 14,
    fontFamily: 'Consolas',
    terminalForeground: '#ffffff',
    terminalBackground: '#1e1e1e',
    lineWrapEnabled: true,
};

describe('TerminalComponentBase', () => {
    it('renders a div container without crashing when no terminalInstance', () => {
        const { container } = render(
            <TerminalComponentBase {...baseProps} terminalInstance={undefined} />
        );
        expect(container.querySelector('.terminal-container')).toBeInTheDocument();
    });

    it('renders without crashing when terminalInstance is provided', () => {
        const { container } = render(
            <TerminalComponentBase
                {...baseProps}
                terminalInstance={mockTerminal as never}
            />
        );
        expect(container.querySelector('.terminal-container')).toBeInTheDocument();
    });

    it('renders without crashing when isActive is false', () => {
        const { container } = render(
            <TerminalComponentBase
                {...baseProps}
                isActive={false}
                terminalInstance={undefined}
            />
        );
        expect(container.querySelector('.terminal-container')).toBeInTheDocument();
    });

    it('renders without crashing with inactive background color', () => {
        const { container } = render(
            <TerminalComponentBase
                {...baseProps}
                terminalBackgroundInactive="#2e2e2e"
                terminalInstance={undefined}
            />
        );
        expect(container.querySelector('.terminal-container')).toBeInTheDocument();
    });

    it('renders without crashing with prompt highlight props', () => {
        const { container } = render(
            <TerminalComponentBase
                {...baseProps}
                enablePromptHighlight={false}
                promptHighlightColor="#ffff00"
                promptPatterns={[]}
                terminalInstance={undefined}
            />
        );
        expect(container.querySelector('.terminal-container')).toBeInTheDocument();
    });
});
