import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AISettingsModal } from './AISettingsModal';
import type { PersonaDefinition } from '../../types/appTypes';

vi.mock('../../services/electronService', () => ({
    aiAuthStatus: vi.fn(() => Promise.resolve(false)),
    aiAuthLogout: vi.fn(() => Promise.resolve()),
    aiSetProvider: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../hooks/useDraggable', () => ({
    useDraggable: vi.fn(() => ({
        position: { x: 0, y: 0 },
        onMouseDown: vi.fn(),
    })),
}));

vi.mock('../../hooks/useFocusTrap', () => ({
    useFocusTrap: vi.fn(),
}));

const defaultPersonas: PersonaDefinition[] = [
    {
        id: 'network-expert',
        label: 'Network Expert',
        systemPrompt: 'You are a Senior Network Engineer.',
        askAiCommands: [
            { id: 'what-is-this', label: 'What is this?', promptTemplate: 'Explain:\n\n{selection}' },
        ],
    },
    {
        id: 'general-helper',
        label: 'General Helper',
        systemPrompt: 'You are a helpful assistant.',
        askAiCommands: [],
    },
];

const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    onLogout: vi.fn(),
    showSystemPrompt: false,
    onShowSystemPromptChange: vi.fn(),
    aiPersonas: defaultPersonas,
    onAiPersonasChange: vi.fn(),
    activePersonaId: 'network-expert',
    onActivePersonaIdChange: vi.fn(),
    watchBufferLimit: 100000,
    onWatchBufferLimitChange: vi.fn(),
    proactiveInstruction: '',
    onProactiveInstructionChange: vi.fn(),
    interactiveStabilizationTimeout: 400,
    onInteractiveStabilizationTimeoutChange: vi.fn(),
};

const renderAndSettle = async (ui: React.ReactElement) => {
    let result!: ReturnType<typeof render>;
    await act(async () => {
        result = render(ui);
    });
    return result;
};

describe('AISettingsModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when isOpen is false', () => {
        const { container } = render(<AISettingsModal {...baseProps} isOpen={false} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the AI Settings heading when open', async () => {
        await renderAndSettle(<AISettingsModal {...baseProps} />);
        expect(screen.getByText('AI Settings')).toBeInTheDocument();
    });

    it('renders AI Provider section', async () => {
        await renderAndSettle(<AISettingsModal {...baseProps} />);
        expect(screen.getByText('AI Provider')).toBeInTheDocument();
    });

    it('renders AI Provider Authentication section', async () => {
        await renderAndSettle(<AISettingsModal {...baseProps} />);
        expect(screen.getByText('AI Provider Authentication')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', async () => {
        const onClose = vi.fn();
        await renderAndSettle(<AISettingsModal {...baseProps} onClose={onClose} />);
        const closeBtn = screen.getAllByText('✕').find(el => el.classList.contains('close-btn'));
        fireEvent.click(closeBtn!);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when Escape key is pressed', async () => {
        const onClose = vi.fn();
        await renderAndSettle(<AISettingsModal {...baseProps} onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders Ask AI Commands section', async () => {
        await renderAndSettle(<AISettingsModal {...baseProps} />);
        expect(screen.getByText('Ask AI Commands')).toBeInTheDocument();
    });

    it('renders Personas section with tabs', async () => {
        await renderAndSettle(<AISettingsModal {...baseProps} />);
        expect(screen.getByText('Personas')).toBeInTheDocument();
        expect(screen.getByText('Network Expert')).toBeInTheDocument();
        expect(screen.getByText('General Helper')).toBeInTheDocument();
    });

    it('renders Show System Prompt checkbox', async () => {
        await renderAndSettle(<AISettingsModal {...baseProps} />);
        expect(screen.getByText('Show System Prompt')).toBeInTheDocument();
    });
});
