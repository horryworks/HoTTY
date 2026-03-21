import React, { useState } from 'react';
import * as electronService from '../../services/electronService';
import { useSettingsStore, DEFAULT_AI_COMMANDS, DEFAULT_PERSONAS } from '../../stores/settingsStore';
import { STORAGE_KEYS } from '../../constants/storage';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import type { PersonaDefinition, AskAiCommand } from '../../types/appTypes';

interface AISettingsTabProps {
    isAiAuthenticated: boolean;
    onAuthenticatedChange: (value: boolean) => void;
    onLogout: () => void;
    watchBufferLimit: number;
    onWatchBufferLimitChange: (limit: number) => void;
    interactiveStabilizationTimeout: number;
    onInteractiveStabilizationTimeoutChange: (timeout: number) => void;
    aiPersonas: PersonaDefinition[];
    onAiPersonasChange: (personas: PersonaDefinition[]) => void;
    activePersonaId: string;
    onActivePersonaIdChange: (id: string) => void;
    proactiveInstruction: string;
    onProactiveInstructionChange: (instruction: string) => void;
    showSystemPrompt: boolean;
    onShowSystemPromptChange: (show: boolean) => void;
    draggedIndex: number | null;
    onDragStart: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
    onDrop: (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => void;
    onDragEnd: () => void;
}

export const AISettingsTab: React.FC<AISettingsTabProps> = ({
    isAiAuthenticated,
    onAuthenticatedChange,
    onLogout,
    watchBufferLimit,
    onWatchBufferLimitChange,
    interactiveStabilizationTimeout,
    onInteractiveStabilizationTimeoutChange,
    aiPersonas,
    onAiPersonasChange,
    activePersonaId,
    onActivePersonaIdChange,
    proactiveInstruction,
    onProactiveInstructionChange,
    showSystemPrompt,
    onShowSystemPromptChange,
    draggedIndex,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
}) => {
    const activeAiProvider = useSettingsStore(s => s.activeAiProvider);
    const updateActiveAiProvider = useSettingsStore(s => s.updateActiveAiProvider);
    const [showGeminiWarning, setShowGeminiWarning] = useState(false);
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

    // Ensure activePersonaId points to an existing persona
    const activePersona = aiPersonas.find(p => p.id === activePersonaId) ?? aiPersonas[0];
    const activeTabId = activePersona?.id ?? '';

    const tabsRef = React.useRef<HTMLDivElement>(null);
    const isDraggingTab = React.useRef(false);
    const tabStartX = React.useRef(0);
    const tabScrollLeft = React.useRef(0);

    const handleTabMouseDown = (e: React.MouseEvent) => {
        isDraggingTab.current = true;
        if (tabsRef.current) {
            tabStartX.current = e.pageX - tabsRef.current.offsetLeft;
            tabScrollLeft.current = tabsRef.current.scrollLeft;
        }
    };

    const handleTabMouseLeave = () => { isDraggingTab.current = false; };
    const handleTabMouseUp = () => { isDraggingTab.current = false; };

    const handleTabMouseMove = (e: React.MouseEvent) => {
        if (!isDraggingTab.current || !tabsRef.current) return;
        e.preventDefault();
        const x = e.pageX - tabsRef.current.offsetLeft;
        const walk = (x - tabStartX.current) * 2;
        tabsRef.current.scrollLeft = tabScrollLeft.current - walk;
    };

    const updatePersona = (personaId: string, updates: Partial<PersonaDefinition>) => {
        const newPersonas = aiPersonas.map(p =>
            p.id === personaId ? { ...p, ...updates } : p
        );
        onAiPersonasChange(newPersonas);
    };

    const updatePersonaCommands = (personaId: string, commands: AskAiCommand[]) => {
        updatePersona(personaId, { askAiCommands: commands });
    };

    return (
        <>
        <div className="form-group">
            {/* ── AI Provider ── */}
            <div style={{ marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px solid var(--border-color)' }}>
                <label style={{ marginBottom: '10px', display: 'block' }}>AI Provider</label>
                <select
                    value={activeAiProvider}
                    onChange={async (e) => {
                        const provider = e.target.value as 'gemini' | 'vertexai' | 'openai' | 'anthropic';
                        updateActiveAiProvider(provider);
                        await electronService.aiSetProvider(provider);
                        const authStatus = await electronService.aiAuthStatus();
                        onAuthenticatedChange(authStatus);
                        if (provider === 'gemini') {
                            setShowGeminiWarning(true);
                        }
                    }}
                    style={{
                        padding: '6px 10px',
                        cursor: 'pointer',
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-primary)',
                        borderRadius: '3px',
                        width: '220px',
                    }}
                >
                    <option value="vertexai">Google Cloud Vertex AI</option>
                    <option value="gemini">Google AI Studio (Gemini)</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="openai">OpenAI</option>
                </select>
                <p className="settings-help" style={{ marginTop: '8px' }}>
                    Select the AI provider to use for the chat panel.
                </p>
            </div>

            {/* ── Authentication ── */}
            <div style={{ marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px solid var(--border-color)' }}>
                <label style={{ marginBottom: '10px', display: 'block' }}>AI Provider Authentication</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            backgroundColor: isAiAuthenticated ? '#4caf50' : '#f44336'
                        }}></div>
                        <span>{isAiAuthenticated ? 'Authenticated' : 'Not Authenticated'}</span>
                    </div>
                    {isAiAuthenticated && (
                        <button
                            onClick={() => setShowLogoutConfirm(true)}
                            style={{
                                padding: '6px 12px',
                                cursor: 'pointer',
                                backgroundColor: 'var(--bg-secondary)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-primary)',
                                borderRadius: '3px'
                            }}
                        >
                            Logout
                        </button>
                    )}
                </div>
            </div>

            {/* ── Persona Tabs ── */}
            <label style={{ marginBottom: '10px', display: 'block' }}>Personas</label>
            <div
                className="settings-tabs ai-persona-tabs"
                ref={tabsRef}
                onMouseDown={handleTabMouseDown}
                onMouseLeave={handleTabMouseLeave}
                onMouseUp={handleTabMouseUp}
                onMouseMove={handleTabMouseMove}
            >
                {aiPersonas.map(persona => (
                    <button
                        key={persona.id}
                        className={`settings-tab ${activeTabId === persona.id ? 'active' : ''}`}
                        onClick={() => onActivePersonaIdChange(persona.id)}
                    >
                        {persona.label}
                    </button>
                ))}
                <button
                    className="settings-tab"
                    onClick={() => {
                        const id = crypto.randomUUID();
                        const newPersona: PersonaDefinition = {
                            id,
                            label: 'New Persona',
                            systemPrompt: 'You are a helpful assistant.',
                            askAiCommands: [...DEFAULT_AI_COMMANDS],
                        };
                        onAiPersonasChange([...aiPersonas, newPersona]);
                        onActivePersonaIdChange(id);
                    }}
                    title="Add Persona"
                >
                    +
                </button>
            </div>

            {/* ── Active Persona Content ── */}
            {activePersona && (
                <div style={{ border: '1px solid var(--border-color)', borderTop: 'none', borderRadius: '0 0 4px 4px', padding: '15px', marginBottom: '20px' }}>
                    {/* Persona Name */}
                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ marginBottom: '6px', display: 'block', fontSize: 'calc(var(--font-size-base) - 1px)' }}>Persona Name</label>
                        <input
                            type="text"
                            value={activePersona.label}
                            onChange={(e) => updatePersona(activeTabId, { label: e.target.value })}
                            placeholder="Display Name"
                            className="settings-input"
                            style={{ width: '100%', padding: '6px', boxSizing: 'border-box' }}
                        />
                    </div>

                    {/* System Prompt */}
                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ marginBottom: '6px', display: 'block', fontSize: 'calc(var(--font-size-base) - 1px)' }}>System Prompt</label>
                        <textarea
                            value={activePersona.systemPrompt}
                            onChange={(e) => updatePersona(activeTabId, { systemPrompt: e.target.value })}
                            placeholder="System Prompt"
                            className="settings-input"
                            style={{
                                width: '100%',
                                padding: '6px',
                                height: '80px',
                                resize: 'vertical',
                                boxSizing: 'border-box'
                            }}
                        />
                    </div>

                    {/* Ask AI Commands */}
                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ marginBottom: '6px', display: 'block', fontSize: 'calc(var(--font-size-base) - 1px)' }}>Ask AI Commands</label>
                        <div className="command-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                            {activePersona.askAiCommands?.map((cmd, index) => (
                                <div
                                    key={cmd.id}
                                    draggable
                                    onDragStart={(e) => onDragStart(e, index)}
                                    onDragOver={(e) => onDragOver(e)}
                                    onDrop={(e) => onDrop(e, index)}
                                    onDragEnd={onDragEnd}
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '4px',
                                        padding: '10px',
                                        backgroundColor: 'var(--bg-secondary)',
                                        borderRadius: '4px',
                                        border: '1px solid var(--border-color)',
                                        opacity: draggedIndex === index ? 0.5 : 1,
                                        cursor: 'grab',
                                        transition: 'opacity 0.2s, transform 0.2s',
                                        transform: draggedIndex === index ? 'scale(0.98)' : 'scale(1)'
                                    }}
                                >
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <span style={{ cursor: 'grab', color: '#888', userSelect: 'none' }}>☰</span>
                                        <input
                                            type="text"
                                            value={cmd.label}
                                            onChange={(e) => {
                                                const newCommands = [...activePersona.askAiCommands];
                                                newCommands[index] = { ...cmd, label: e.target.value };
                                                updatePersonaCommands(activeTabId, newCommands);
                                            }}
                                            placeholder="Label"
                                            className="settings-input"
                                            style={{ flex: 1, padding: '4px' }}
                                        />
                                        <button
                                            onClick={() => {
                                                const newCommands = activePersona.askAiCommands.filter((_, i) => i !== index);
                                                updatePersonaCommands(activeTabId, newCommands);
                                            }}
                                            style={{ padding: '4px 8px', cursor: 'pointer', backgroundColor: '#d32f2f', color: 'white', border: 'none', borderRadius: '3px' }}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                    <textarea
                                        value={cmd.promptTemplate}
                                        onChange={(e) => {
                                            const newCommands = [...activePersona.askAiCommands];
                                            newCommands[index] = { ...cmd, promptTemplate: e.target.value };
                                            updatePersonaCommands(activeTabId, newCommands);
                                        }}
                                        placeholder="Prompt Template ({selection} will be replaced)"
                                        className="settings-input"
                                        style={{
                                            width: '100%',
                                            padding: '6px',
                                            height: '60px',
                                            fontFamily: 'monospace',
                                            resize: 'vertical',
                                            boxSizing: 'border-box'
                                        }}
                                    />
                                    <div style={{ color: '#888' }}>
                                        Use <code>{'{selection}'}</code> placeholder for the selected text.
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                onClick={() => {
                                    const id = crypto.randomUUID();
                                    const newCommand: AskAiCommand = { id, label: 'New Command', promptTemplate: '{selection}' };
                                    updatePersonaCommands(activeTabId, [...(activePersona.askAiCommands || []), newCommand]);
                                }}
                                style={{ padding: '6px 12px', cursor: 'pointer' }}
                            >
                                + Add Command
                            </button>
                            <button
                                onClick={() => {
                                    if (confirm('Reset commands to defaults for this persona?')) {
                                        updatePersonaCommands(activeTabId, [...DEFAULT_AI_COMMANDS]);
                                    }
                                }}
                                style={{ padding: '6px 12px', cursor: 'pointer' }}
                            >
                                Reset Commands
                            </button>
                        </div>
                    </div>

                    {/* Delete Persona */}
                    <div style={{ textAlign: 'right' }}>
                        <button
                            onClick={() => {
                                if (aiPersonas.length <= 1) {
                                    alert('At least one persona is required.');
                                    return;
                                }
                                if (confirm(`Delete "${activePersona.label}"?`)) {
                                    const newPersonas = aiPersonas.filter(p => p.id !== activeTabId);
                                    onAiPersonasChange(newPersonas);
                                    onActivePersonaIdChange(newPersonas[0].id);
                                }
                            }}
                            style={{
                                padding: '6px 12px',
                                cursor: 'pointer',
                                backgroundColor: '#d32f2f',
                                color: 'white',
                                border: 'none',
                                borderRadius: '3px',
                            }}
                        >
                            Delete Persona
                        </button>
                    </div>
                </div>
            )}

            {/* ── Reset All Personas ── */}
            <div style={{ marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px solid var(--border-color)' }}>
                <button
                    onClick={() => {
                        if (confirm('Reset all personas to defaults? This will remove all custom personas and commands.')) {
                            onAiPersonasChange([...DEFAULT_PERSONAS]);
                            onActivePersonaIdChange(DEFAULT_PERSONAS[0].id);
                        }
                    }}
                    style={{ padding: '6px 12px', cursor: 'pointer', backgroundColor: '#d32f2f', color: 'white', border: 'none', borderRadius: '3px' }}
                >
                    Reset All Personas
                </button>
            </div>

            {/* ── Advanced Settings ── */}
            <div style={{ marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px solid var(--border-color)' }}>
                <label style={{ marginBottom: '10px', display: 'block' }}>Watch Buffer Limit (Characters)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                        type="number"
                        value={watchBufferLimit}
                        onChange={(e) => onWatchBufferLimitChange(parseInt(e.target.value, 10))}
                        min="10000"
                        max="5000000"
                        step="10000"
                        className="settings-input"
                        style={{ width: '120px', padding: '6px' }}
                    />
                    <span style={{ fontSize: '0.9em', color: 'var(--text-muted)' }}>
                        Default: 500,000. Higher limits consume more memory.
                    </span>
                </div>
            </div>

            <div style={{ marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px solid var(--border-color)' }}>
                <label style={{ marginBottom: '10px', display: 'block' }}>Interactive Flow Stabilization Timeout (ms)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                        type="number"
                        value={interactiveStabilizationTimeout}
                        onChange={(e) => onInteractiveStabilizationTimeoutChange(parseInt(e.target.value, 10))}
                        min="100"
                        max="60000"
                        step="500"
                        className="settings-input"
                        style={{ width: '120px', padding: '6px' }}
                    />
                    <span style={{ fontSize: '0.9em', color: 'var(--text-muted)' }}>
                        Default: 10,000 (10s). Wait time after prompt detection before sending to AI.
                    </span>
                </div>
            </div>

            <div style={{ marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px solid var(--border-color)' }}>
                <label style={{ marginBottom: '10px', display: 'block' }}>Proactive Investigation Instruction</label>
                <textarea
                    value={proactiveInstruction}
                    onChange={(e) => onProactiveInstructionChange(e.target.value)}
                    placeholder="Instruction to encourage the AI to gather more info..."
                    className="settings-input"
                    style={{
                        width: '100%',
                        padding: '10px',
                        height: '100px',
                        fontFamily: 'monospace',
                        resize: 'vertical',
                        boxSizing: 'border-box'
                    }}
                />
                <p className="settings-help" style={{ marginTop: '8px' }}>
                    This instruction is appended to the system prompt and terminal output responses to encourage the AI to proactively search for information.
                </p>
            </div>

            <label>Debugging</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal', whiteSpace: 'nowrap' }}>
                    <input
                        type="checkbox"
                        checked={showSystemPrompt}
                        onChange={(e) => onShowSystemPromptChange(e.target.checked)}
                        style={{ marginRight: '8px' }}
                    />
                    Show System Prompt
                </label>
            </div>
            <p className="settings-help">Display hidden system instructions in the chat view.</p>

            {showGeminiWarning && (
                <div className="confirm-modal-overlay">
                    <div className="confirm-modal">
                        <h3>⚠️ Privacy Notice</h3>
                        <div className="confirm-content">
                            Google AI Studio (Gemini) may use your input and output data for AI training if you are on the free tier (no billing configured).{'\n\n'}
                            If you have not set up billing on your Google account, your conversation data may be used to improve Google's AI models.{'\n\n'}
                            To opt out, enable billing on your Google Cloud project.
                        </div>
                        <div className="confirm-modal-actions">
                            <button
                                className="confirm-btn"
                                onClick={() => setShowGeminiWarning(false)}
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
        {showLogoutConfirm && (
            <ConfirmModal
                title="Logout"
                message="Are you sure you want to logout? You will need to re-authenticate to use the AI provider."
                confirmLabel="Logout"
                onConfirm={async () => {
                    setShowLogoutConfirm(false);
                    localStorage.setItem(STORAGE_KEYS.AI_EXPLICIT_LOGOUT, '1');
                    await electronService.aiAuthLogout();
                    onAuthenticatedChange(false);
                    onLogout();
                }}
                onCancel={() => setShowLogoutConfirm(false)}
            />
        )}
        </>
    );
};
