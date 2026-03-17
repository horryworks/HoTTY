import React, { useState } from 'react';
import * as electronService from '../../services/electronService';
import { useSettingsStore } from '../../stores/settingsStore';
import '../ConfirmModal/ConfirmModal.css';

interface AISettingsTabProps {
    isAiAuthenticated: boolean;
    onAuthenticatedChange: (value: boolean) => void;
    onLogout: () => void;
    watchBufferLimit: number;
    onWatchBufferLimitChange: (limit: number) => void;
    interactiveStabilizationTimeout: number;
    onInteractiveStabilizationTimeoutChange: (timeout: number) => void;
    askAiCommands: { id: string; label: string; promptTemplate: string }[];
    onAskAiCommandsChange: (commands: { id: string; label: string; promptTemplate: string }[]) => void;
    aiPersonas: { id: string; label: string; systemPrompt: string }[];
    onAiPersonasChange: (personas: { id: string; label: string; systemPrompt: string }[]) => void;
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
    askAiCommands,
    onAskAiCommandsChange,
    aiPersonas,
    onAiPersonasChange,
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

    return (
        <div className="form-group">
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
                            onClick={async () => {
                                if (confirm('Are you sure you want to logout? You will need to re-authenticate to use the AI provider.')) {
                                    await electronService.aiAuthLogout();
                                    onAuthenticatedChange(false);
                                    onLogout();
                                }
                            }}
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

            <label style={{ marginBottom: '10px', display: 'block' }}>Ask AI Commands</label>

            <div className="command-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                {askAiCommands?.map((cmd, index) => (
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
                                    const newCommands = [...askAiCommands];
                                    newCommands[index] = { ...cmd, label: e.target.value };
                                    onAskAiCommandsChange(newCommands);
                                }}
                                placeholder="Label"
                                className="settings-input"
                                style={{ flex: 1, padding: '4px' }}
                            />
                            <button
                                onClick={() => {
                                    const newCommands = askAiCommands.filter((_, i) => i !== index);
                                    onAskAiCommandsChange(newCommands);
                                }}
                                style={{ padding: '4px 8px', cursor: 'pointer', backgroundColor: '#d32f2f', color: 'white', border: 'none', borderRadius: '3px' }}
                            >
                                ✕
                            </button>
                        </div>
                        <textarea
                            value={cmd.promptTemplate}
                            onChange={(e) => {
                                const newCommands = [...askAiCommands];
                                newCommands[index] = { ...cmd, promptTemplate: e.target.value };
                                onAskAiCommandsChange(newCommands);
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

            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px solid var(--border-color)' }}>
                <button
                    onClick={() => {
                        const id = crypto.randomUUID();
                        const newCommand = { id, label: 'New Command', promptTemplate: '{selection}' };
                        onAskAiCommandsChange([...(askAiCommands || []), newCommand]);
                    }}
                    style={{ padding: '6px 12px', cursor: 'pointer' }}
                >
                    + Add Command
                </button>
                <button
                    onClick={() => {
                        if (confirm('Reset to default commands?')) {
                            const DEFAULT_COMMANDS = [
                                { id: 'what-is-this', label: 'What is this?', promptTemplate: 'Explain the following text or code snippet concisely:\n\n{selection}' },
                                { id: 'what-does-it-mean', label: 'What does it mean?', promptTemplate: 'Interpret the meaning of this log entry or message and its implications:\n\n{selection}' },
                                { id: 'root-cause', label: 'Research root cause', promptTemplate: 'Analyze the following error or issue, identify 3 potential root causes, and suggest verification steps for each:\n\n{selection}' },
                                { id: 'fix-this', label: 'Fix this', promptTemplate: 'Suggest a fix or improvement for the selected code or configuration:\n\n{selection}' },
                            ];
                            onAskAiCommandsChange(DEFAULT_COMMANDS);
                        }
                    }}
                    style={{ padding: '6px 12px', cursor: 'pointer' }}
                >
                    Reset Defaults
                </button>
            </div>

            <div style={{ marginBottom: '20px' }}>
                <label style={{ marginBottom: '10px', display: 'block' }}>Personas</label>

                <div className="command-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                    {aiPersonas?.map((persona, index) => (
                        <div
                            key={persona.id}
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                                padding: '10px',
                                backgroundColor: 'var(--bg-secondary)',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                            }}
                        >
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    value={persona.label}
                                    onChange={(e) => {
                                        const newPersonas = [...aiPersonas];
                                        newPersonas[index] = { ...persona, label: e.target.value };
                                        onAiPersonasChange(newPersonas);
                                    }}
                                    placeholder="Display Name"
                                    className="settings-input"
                                    style={{ flex: 1, padding: '4px' }}
                                />
                                <button
                                    onClick={() => {
                                        if (confirm('Delete this persona?')) {
                                            const newPersonas = aiPersonas.filter((_, i) => i !== index);
                                            onAiPersonasChange(newPersonas);
                                        }
                                    }}
                                    style={{ padding: '4px 8px', cursor: 'pointer', backgroundColor: '#d32f2f', color: 'white', border: 'none', borderRadius: '3px' }}
                                >
                                    ✕
                                </button>
                            </div>
                            <textarea
                                value={persona.systemPrompt}
                                onChange={(e) => {
                                    const newPersonas = [...aiPersonas];
                                    newPersonas[index] = { ...persona, systemPrompt: e.target.value };
                                    onAiPersonasChange(newPersonas);
                                }}
                                placeholder="System Prompt"
                                className="settings-input"
                                style={{
                                    width: '100%',
                                    padding: '6px',
                                    height: '60px',
                                    resize: 'vertical',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px solid var(--border-color)' }}>
                    <button
                        onClick={() => {
                            const id = crypto.randomUUID();
                            const newPersona = { id, label: 'New Persona', systemPrompt: 'You are a helpful assistant.' };
                            onAiPersonasChange([...(aiPersonas || []), newPersona]);
                        }}
                        style={{ padding: '6px 12px', cursor: 'pointer' }}
                    >
                        + Add Persona
                    </button>
                    <button
                        onClick={() => {
                            if (confirm('Reset to default personas?')) {
                                const DEFAULT_PERSONAS = [
                                    { id: 'general-helper', label: 'General Helper', systemPrompt: 'You are a helpful technical assistant. Provide clear, concise, and accurate answers. When explaining concepts, use analogies where appropriate.' },
                                    { id: 'network-expert', label: 'Network Expert', systemPrompt: 'You are a Senior Network Engineer. Analyze network issues with a focus on OSI layers, routing protocols (BGP, OSPF), and switching. Use industry-standard terminology (Cisco/Juniper syntax) and formatting.' },
                                    { id: 'server-expert', label: 'Server Expert', systemPrompt: 'You are a Systems Administrator specializing in Linux and Windows servers. Focus on OS internals, kernel parameters, performance tuning, and security best practices. Provide specific commands for troubleshooting.' },
                                    { id: 'cloud-expert', label: 'Cloud Expert', systemPrompt: 'You are a Cloud Architect (AWS/Azure/GCP). Advise on cloud-native patterns, microservices, and infrastructure-as-code (Terraform/K8s). Prioritize scalability, cost-efficiency, and security in your recommendations.' },
                                    { id: 'coding-expert', label: 'Coding Expert', systemPrompt: 'You are a Senior Software Engineer. Provide idiomatic, clean, and performant code solutions. Explain time/space complexity (Big O) where relevant. Prefer modern syntax and safety.' },
                                    { id: 'security-analyst', label: 'Security Analyst', systemPrompt: 'You are a Cybersecurity Analyst. Analyze logs and configurations for potential vulnerabilities, threats, and indicators of compromise (IoCs). Recommend mitigation strategies based on industry standards (NIST/CIS).' },
                                ];
                                onAiPersonasChange(DEFAULT_PERSONAS);
                            }
                        }}
                        style={{ padding: '6px 12px', cursor: 'pointer' }}
                    >
                        Reset Defaults
                    </button>
                </div>
                <p className="settings-help">The default system instruction sent to the AI when starting a new session.</p>
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
    );
};
