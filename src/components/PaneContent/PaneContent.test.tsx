import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaneContent } from './PaneContent';
import type { Session } from '../../hooks/useSessionManager';

vi.mock('../Terminal/Terminal', () => ({
    TerminalComponent: () => <div data-testid="terminal" />,
}));
vi.mock('../AIChatPane/AIChatPane', () => ({
    AIChatPane: () => <div data-testid="ai-chat" />,
}));
vi.mock('../LogViewerPane/LogViewerPane', () => ({
    LogViewerPane: () => <div data-testid="log-viewer" />,
}));
vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: vi.fn((selector?: (s: unknown) => unknown) => {
        const state = {
            fontSize: 14,
            fontFamily: 'Consolas',
            theme: 'dark',
            terminalForeground: '#ffffff',
            terminalBackground: '#1e1e1e',
            terminalBackgroundInactive: '#2e2e2e',
            lineWrapEnabled: true,
            scrollback: 1000,
            backspaceSendsDel: false,
            rightClickPaste: false,
            showSystemPrompt: false,
            enablePromptHighlight: false,
            promptHighlightColor: '#ffff00',
            promptPatterns: [],
            aiPersonas: [],
            askAiCommands: [],
            sidebarPosition: 'right',
            proactiveInstruction: '',
            interactiveStabilizationTimeout: 400,
        };
        return typeof selector === 'function' ? selector(state) : state;
    }),
}));

const baseProps = {
    isActive: true,
    focusTrigger: 0,
    disableFocus: false,
    terminalInstance: undefined,
    onData: vi.fn(),
    onPasteRequest: vi.fn(),
};

const sshSession: Session = { id: 's1', title: 'SSH Host', type: 'ssh' };
const telnetSession: Session = { id: 't1', title: 'Telnet Host', type: 'telnet' };
const localSession: Session = { id: 'l1', title: 'Local', type: 'local' };
const aiSession: Session = {
    id: 'ai1',
    title: 'AI',
    type: 'ai',
    aiChatState: {
        messages: [],
        inputText: '',
        selectedModel: 'gemini',
        selectedLanguage: 'English',
        textareaHeight: 0,
    },
};
const logSession: Session = {
    id: 'log1',
    title: 'Log',
    type: 'log-viewer',
    logViewerState: { loggingPath: '/logs' },
};

describe('PaneContent', () => {
    it('renders terminal component for SSH session', () => {
        render(<PaneContent {...baseProps} session={sshSession} />);
        expect(screen.getByTestId('terminal')).toBeInTheDocument();
    });

    it('renders terminal component for Telnet session', () => {
        render(<PaneContent {...baseProps} session={telnetSession} />);
        expect(screen.getByTestId('terminal')).toBeInTheDocument();
    });

    it('renders terminal component for Local session', () => {
        render(<PaneContent {...baseProps} session={localSession} />);
        expect(screen.getByTestId('terminal')).toBeInTheDocument();
    });

    it('renders AI chat pane for AI session', () => {
        render(<PaneContent {...baseProps} session={aiSession} />);
        expect(screen.getByTestId('ai-chat')).toBeInTheDocument();
    });

    it('renders log viewer pane for log-viewer session', () => {
        render(<PaneContent {...baseProps} session={logSession} />);
        expect(screen.getByTestId('log-viewer')).toBeInTheDocument();
    });

    it('does not render ai-chat for SSH session', () => {
        render(<PaneContent {...baseProps} session={sshSession} />);
        expect(screen.queryByTestId('ai-chat')).not.toBeInTheDocument();
    });

    it('does not render log-viewer for AI session', () => {
        render(<PaneContent {...baseProps} session={aiSession} />);
        expect(screen.queryByTestId('log-viewer')).not.toBeInTheDocument();
    });
});
