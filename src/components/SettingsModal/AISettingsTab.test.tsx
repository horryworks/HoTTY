import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AISettingsTab } from './AISettingsTab';
import type { PersonaDefinition } from '../../types/appTypes';

vi.mock('../../services/electronService', () => ({
    getThemes: vi.fn(() => Promise.resolve({})),
    getSshAlgorithms: vi.fn(() => Promise.resolve({ kex: [], cipher: [], mac: [], compress: [] })),
    saveSshAlgorithms: vi.fn(),
    saveCustomTheme: vi.fn(),
    deleteCustomTheme: vi.fn(),
    selectImage: vi.fn(),
    selectFolder: vi.fn(),
    updateLogging: vi.fn(),
    openDebugLogFolder: vi.fn(),
    logDebug: vi.fn(),
    getAppVersion: vi.fn(() => Promise.resolve('1.0.0')),
    aiAuthLogout: vi.fn(() => Promise.resolve()),
    aiAuthStatus: vi.fn(() => Promise.resolve(false)),
    aiSetProvider: vi.fn(() => Promise.resolve()),
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
    isAiAuthenticated: false,
    onAuthenticatedChange: vi.fn(),
    onLogout: vi.fn(),
    watchBufferLimit: 100000,
    onWatchBufferLimitChange: vi.fn(),
    interactiveStabilizationTimeout: 400,
    onInteractiveStabilizationTimeoutChange: vi.fn(),
    aiPersonas: defaultPersonas,
    onAiPersonasChange: vi.fn(),
    activePersonaId: 'network-expert',
    onActivePersonaIdChange: vi.fn(),
    proactiveInstruction: '',
    onProactiveInstructionChange: vi.fn(),
    commandExecutionMode: 'ask-before-execute' as const,
    onCommandExecutionModeChange: vi.fn(),
    maxConsecutiveAutoExecutions: 10,
    onMaxConsecutiveAutoExecutionsChange: vi.fn(),
    customSafeCommands: [] as string[],
    onCustomSafeCommandsChange: vi.fn(),
    showSystemPrompt: false,
    onShowSystemPromptChange: vi.fn(),
    draggedIndex: null,
    onDragStart: vi.fn(),
    onDragOver: vi.fn(),
    onDrop: vi.fn(),
    onDragEnd: vi.fn(),
};

describe('AISettingsTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders without crashing', () => {
        const { container } = render(<AISettingsTab {...baseProps} />);
        expect(container).toBeTruthy();
    });

    it('renders AI Provider section', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('AI Provider')).toBeInTheDocument();
    });

    it('renders Google AI Studio option in provider dropdown', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Google AI Studio (Gemini)')).toBeInTheDocument();
    });

    it('renders Vertex AI option in provider dropdown', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Google Cloud Vertex AI')).toBeInTheDocument();
    });

    it('renders OpenAI option in provider dropdown', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('OpenAI')).toBeInTheDocument();
    });

    it('renders Anthropic option in provider dropdown', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Anthropic (Claude)')).toBeInTheDocument();
    });

    it('renders AI Provider Authentication label', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('AI Provider Authentication')).toBeInTheDocument();
    });

    it('shows "Not Authenticated" status when not authenticated', () => {
        render(<AISettingsTab {...baseProps} isAiAuthenticated={false} />);
        expect(screen.getByText('Not Authenticated')).toBeInTheDocument();
    });

    it('shows "Authenticated" status when authenticated', () => {
        render(<AISettingsTab {...baseProps} isAiAuthenticated={true} />);
        expect(screen.getByText('Authenticated')).toBeInTheDocument();
    });

    it('shows logout button when authenticated', () => {
        render(<AISettingsTab {...baseProps} isAiAuthenticated={true} />);
        expect(screen.getByText('Logout')).toBeInTheDocument();
    });

    it('does not show logout button when not authenticated', () => {
        render(<AISettingsTab {...baseProps} isAiAuthenticated={false} />);
        expect(screen.queryByText('Logout')).not.toBeInTheDocument();
    });

    it('renders AI Monitor Buffer Limit section', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('AI Monitor Buffer Limit (Characters)')).toBeInTheDocument();
    });

    it('renders watch buffer limit input with correct value', () => {
        render(<AISettingsTab {...baseProps} watchBufferLimit={500000} />);
        const inputs = screen.getAllByRole('spinbutton');
        const bufferInput = inputs.find(i => (i as HTMLInputElement).value === '500000');
        expect(bufferInput).toBeInTheDocument();
    });

    it('calls onWatchBufferLimitChange when buffer limit changes', () => {
        const onWatchBufferLimitChange = vi.fn();
        render(<AISettingsTab {...baseProps} onWatchBufferLimitChange={onWatchBufferLimitChange} />);
        const inputs = screen.getAllByRole('spinbutton');
        fireEvent.change(inputs[0], { target: { value: '200000' } });
        expect(onWatchBufferLimitChange).toHaveBeenCalledWith(200000);
    });

    it('renders Command Output Wait Time section', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Command Output Wait Time (ms)')).toBeInTheDocument();
    });

    it('renders Personas section with tabs', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Personas')).toBeInTheDocument();
        expect(screen.getByText('Network Expert')).toBeInTheDocument();
        expect(screen.getByText('General Helper')).toBeInTheDocument();
    });

    it('renders Ask AI Commands for active persona', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Ask AI Commands')).toBeInTheDocument();
        expect(screen.getByDisplayValue('What is this?')).toBeInTheDocument();
    });

    it('renders + Add Command button', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('+ Add Command')).toBeInTheDocument();
    });

    it('renders Reset Commands button', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Reset Commands')).toBeInTheDocument();
    });

    it('calls onAiPersonasChange when Add Command is clicked', () => {
        const onAiPersonasChange = vi.fn();
        render(<AISettingsTab {...baseProps} onAiPersonasChange={onAiPersonasChange} />);
        fireEvent.click(screen.getByText('+ Add Command'));
        expect(onAiPersonasChange).toHaveBeenCalledTimes(1);
        const updated = onAiPersonasChange.mock.calls[0][0] as PersonaDefinition[];
        const activePersona = updated.find(p => p.id === 'network-expert')!;
        expect(activePersona.askAiCommands).toHaveLength(2);
        expect(activePersona.askAiCommands[1].label).toBe('New Command');
    });

    it('renders existing ask AI commands for active persona', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByDisplayValue('What is this?')).toBeInTheDocument();
    });

    it('renders + button to add persona', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('+')).toBeInTheDocument();
    });

    it('calls onAiPersonasChange and onActivePersonaIdChange when + persona is clicked', () => {
        const onAiPersonasChange = vi.fn();
        const onActivePersonaIdChange = vi.fn();
        render(<AISettingsTab {...baseProps} onAiPersonasChange={onAiPersonasChange} onActivePersonaIdChange={onActivePersonaIdChange} />);
        fireEvent.click(screen.getByText('+'));
        expect(onAiPersonasChange).toHaveBeenCalledTimes(1);
        const newPersonas = onAiPersonasChange.mock.calls[0][0] as PersonaDefinition[];
        expect(newPersonas).toHaveLength(3);
        expect(newPersonas[2].label).toBe('New Persona');
        expect(onActivePersonaIdChange).toHaveBeenCalledTimes(1);
    });

    it('calls onActivePersonaIdChange when persona tab is clicked', () => {
        const onActivePersonaIdChange = vi.fn();
        render(<AISettingsTab {...baseProps} onActivePersonaIdChange={onActivePersonaIdChange} />);
        fireEvent.click(screen.getByText('General Helper'));
        expect(onActivePersonaIdChange).toHaveBeenCalledWith('general-helper');
    });

    it('renders Show System Prompt checkbox', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Show System Prompt')).toBeInTheDocument();
    });

    it('calls onShowSystemPromptChange when checkbox changes', () => {
        const onShowSystemPromptChange = vi.fn();
        render(<AISettingsTab {...baseProps} onShowSystemPromptChange={onShowSystemPromptChange} />);
        const checkboxes = screen.getAllByRole('checkbox');
        const showSystemPromptCheckbox = checkboxes[checkboxes.length - 1];
        fireEvent.click(showSystemPromptCheckbox);
        expect(onShowSystemPromptChange).toHaveBeenCalled();
    });

    it('calls aiAuthStatus and onAuthenticatedChange when provider changes', async () => {
        const { aiAuthStatus } = await import('../../services/electronService');
        (aiAuthStatus as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        const onAuthenticatedChange = vi.fn();
        render(<AISettingsTab {...baseProps} onAuthenticatedChange={onAuthenticatedChange} />);
        const select = screen.getAllByRole('combobox')[0];
        fireEvent.change(select, { target: { value: 'vertexai' } });
        await waitFor(() => {
            expect(aiAuthStatus).toHaveBeenCalled();
            expect(onAuthenticatedChange).toHaveBeenCalledWith(true);
        });
    });

    it('shows privacy warning when Google AI Studio (Gemini) is selected', async () => {
        render(<AISettingsTab {...baseProps} />);
        const select = screen.getAllByRole('combobox')[0];
        fireEvent.change(select, { target: { value: 'gemini' } });
        await waitFor(() => {
            expect(screen.getByText(/Privacy Notice/)).toBeInTheDocument();
        });
    });

    it('does not show privacy warning when non-Gemini provider is selected', async () => {
        render(<AISettingsTab {...baseProps} />);
        const select = screen.getAllByRole('combobox')[0];
        fireEvent.change(select, { target: { value: 'vertexai' } });
        await waitFor(() => {
            expect(screen.queryByText(/Privacy Notice/)).not.toBeInTheDocument();
        });
    });

    it('dismisses privacy warning when OK is clicked', async () => {
        render(<AISettingsTab {...baseProps} />);
        const select = screen.getAllByRole('combobox')[0];
        fireEvent.change(select, { target: { value: 'gemini' } });
        await waitFor(() => {
            expect(screen.getByText(/Privacy Notice/)).toBeInTheDocument();
        });
        fireEvent.click(screen.getByText('OK'));
        expect(screen.queryByText(/Privacy Notice/)).not.toBeInTheDocument();
    });

    it('renders Proactive Investigation Instruction textarea', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Proactive Investigation Instruction')).toBeInTheDocument();
    });

    it('calls onProactiveInstructionChange when textarea changes', () => {
        const onProactiveInstructionChange = vi.fn();
        render(<AISettingsTab {...baseProps} onProactiveInstructionChange={onProactiveInstructionChange} />);
        const textareas = screen.getAllByRole('textbox');
        const proactiveTextarea = textareas.find(t => t.getAttribute('placeholder')?.includes('proactive') || t.getAttribute('placeholder')?.includes('Instruction'));
        if (proactiveTextarea) {
            fireEvent.change(proactiveTextarea, { target: { value: 'New instruction' } });
            expect(onProactiveInstructionChange).toHaveBeenCalledWith('New instruction');
        }
    });

    it('renders Reset All Personas button', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Reset All Personas')).toBeInTheDocument();
    });

    it('renders Delete Persona button', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Delete Persona')).toBeInTheDocument();
    });
});
