import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AISettingsTab } from './AISettingsTab';

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
    geminiAuthLogout: vi.fn(() => Promise.resolve()),
}));

const baseProps = {
    isAiAuthenticated: false,
    onAuthenticatedChange: vi.fn(),
    onLogout: vi.fn(),
    watchBufferLimit: 100000,
    onWatchBufferLimitChange: vi.fn(),
    interactiveStabilizationTimeout: 400,
    onInteractiveStabilizationTimeoutChange: vi.fn(),
    askGeminiCommands: [],
    onAskGeminiCommandsChange: vi.fn(),
    aiPersonas: [],
    onAiPersonasChange: vi.fn(),
    proactiveInstruction: '',
    onProactiveInstructionChange: vi.fn(),
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

    it('renders Google Account Authentication label', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Google Account Authentication')).toBeInTheDocument();
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
        expect(screen.getByText('Logout from Gemini')).toBeInTheDocument();
    });

    it('does not show logout button when not authenticated', () => {
        render(<AISettingsTab {...baseProps} isAiAuthenticated={false} />);
        expect(screen.queryByText('Logout from Gemini')).not.toBeInTheDocument();
    });

    it('renders Watch Buffer Limit section', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Watch Buffer Limit (Characters)')).toBeInTheDocument();
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

    it('renders Interactive Flow Stabilization Timeout section', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Interactive Flow Stabilization Timeout (ms)')).toBeInTheDocument();
    });

    it('renders Ask AI Commands section', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Ask AI Commands')).toBeInTheDocument();
    });

    it('renders Add Command button', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('+ Add Command')).toBeInTheDocument();
    });

    it('renders Reset Defaults button for commands', () => {
        render(<AISettingsTab {...baseProps} />);
        const resetButtons = screen.getAllByText('Reset Defaults');
        expect(resetButtons.length).toBeGreaterThan(0);
    });

    it('calls onAskGeminiCommandsChange when Add Command is clicked', () => {
        const onAskGeminiCommandsChange = vi.fn();
        render(<AISettingsTab {...baseProps} onAskGeminiCommandsChange={onAskGeminiCommandsChange} />);
        fireEvent.click(screen.getByText('+ Add Command'));
        expect(onAskGeminiCommandsChange).toHaveBeenCalledTimes(1);
        const newCommands = onAskGeminiCommandsChange.mock.calls[0][0];
        expect(newCommands).toHaveLength(1);
        expect(newCommands[0].label).toBe('New Command');
    });

    it('renders existing ask gemini commands', () => {
        const commands = [{ id: 'cmd1', label: 'Test Command', promptTemplate: 'Test {selection}' }];
        render(<AISettingsTab {...baseProps} askGeminiCommands={commands} />);
        expect(screen.getByDisplayValue('Test Command')).toBeInTheDocument();
    });

    it('renders Personas section', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('Personas')).toBeInTheDocument();
    });

    it('renders Add Persona button', () => {
        render(<AISettingsTab {...baseProps} />);
        expect(screen.getByText('+ Add Persona')).toBeInTheDocument();
    });

    it('calls onAiPersonasChange when Add Persona is clicked', () => {
        const onAiPersonasChange = vi.fn();
        render(<AISettingsTab {...baseProps} onAiPersonasChange={onAiPersonasChange} />);
        fireEvent.click(screen.getByText('+ Add Persona'));
        expect(onAiPersonasChange).toHaveBeenCalledTimes(1);
        const newPersonas = onAiPersonasChange.mock.calls[0][0];
        expect(newPersonas).toHaveLength(1);
        expect(newPersonas[0].label).toBe('New Persona');
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
});
