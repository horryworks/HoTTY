import React from 'react';
import { useDraggable } from '../../hooks/useDraggable';
import './SettingsModal.css';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    encoding: string;
    onEncodingChange: (encoding: string) => void;
    fontSize: number;
    onFontSizeChange: (size: number) => void;
    fontFamily: string;
    onFontFamilyChange: (family: string) => void;
    sshKeepAliveEnabled: boolean;
    onSshKeepAliveEnabledChange: (enabled: boolean) => void;
    sshKeepAliveInterval: number;
    onSshKeepAliveIntervalChange: (interval: number) => void;
    terminalForeground: string;
    onTerminalForegroundChange: (color: string) => void;
    terminalBackground: string;
    onTerminalBackgroundChange: (color: string) => void;
    terminalBackgroundInactive: string;
    onTerminalBackgroundInactiveChange: (color: string) => void;
    paneBackground: string;
    onPaneBackgroundChange: (color: string) => void;
    paneBackgroundMode: 'color' | 'image';
    onPaneBackgroundModeChange: (mode: 'color' | 'image') => void;
    paneBackgroundImage: string;
    onPaneBackgroundImageChange: (url: string) => void;
    loggingEnabled: boolean;
    onLoggingEnabledChange: (enabled: boolean) => void;
    loggingPath: string;
    onLoggingPathChange: (path: string) => void;
    scrollback: number;
    onScrollbackChange: (lines: number) => void;
    theme: 'dark' | 'light' | 'medium' | 'custom';
    onThemeChange: (theme: 'dark' | 'light' | 'medium' | 'custom') => void;
    showSystemPrompt: boolean;
    onShowSystemPromptChange: (show: boolean) => void;
    askGeminiCommands: { id: string; label: string; promptTemplate: string }[];
    onAskGeminiCommandsChange: (commands: { id: string; label: string; promptTemplate: string }[]) => void;
    aiPersonas: { id: string; label: string; systemPrompt: string }[];
    onAiPersonasChange: (personas: { id: string; label: string; systemPrompt: string }[]) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
    isOpen,
    onClose,
    encoding,
    onEncodingChange,
    fontSize,
    onFontSizeChange,
    fontFamily,
    onFontFamilyChange,
    sshKeepAliveEnabled,
    onSshKeepAliveEnabledChange,
    sshKeepAliveInterval,
    onSshKeepAliveIntervalChange,
    terminalForeground,
    onTerminalForegroundChange,
    terminalBackground,
    onTerminalBackgroundChange,
    terminalBackgroundInactive,
    onTerminalBackgroundInactiveChange,
    paneBackground,
    onPaneBackgroundChange,
    paneBackgroundMode,
    onPaneBackgroundModeChange,
    paneBackgroundImage,
    onPaneBackgroundImageChange,
    loggingEnabled,
    onLoggingEnabledChange,
    loggingPath,
    onLoggingPathChange,
    scrollback,
    onScrollbackChange,
    theme,
    onThemeChange,
    showSystemPrompt,
    onShowSystemPromptChange,
    askGeminiCommands,
    onAskGeminiCommandsChange,
    aiPersonas,
    onAiPersonasChange
}) => {
    const { position, onMouseDown: onHeaderMouseDown } = useDraggable();
    const [activeTab, setActiveTab] = React.useState<'appearance' | 'network' | 'system' | 'ai' | 'about'>('appearance');
    const [version, setVersion] = React.useState<string>('');

    React.useEffect(() => {
        if (isOpen) {
            window.electronAPI.getAppVersion().then(setVersion);
        }
    }, [isOpen]);

    const handleClose = () => {
        if (loggingEnabled && !loggingPath) {
            alert('Logging is enabled but no folder path is selected.\nPlease select a folder or disable logging.');
            setActiveTab('system'); // Switch to system tab so user can see the error
            return;
        }
        onClose();
    };

    const tabsRef = React.useRef<HTMLDivElement>(null);
    const isDragging = React.useRef(false);
    const startX = React.useRef(0);
    const scrollLeft = React.useRef(0);

    const handleMouseDown = (e: React.MouseEvent) => {
        isDragging.current = true;
        if (tabsRef.current) {
            startX.current = e.pageX - tabsRef.current.offsetLeft;
            scrollLeft.current = tabsRef.current.scrollLeft;
        }
    };

    const handleMouseLeave = () => {
        isDragging.current = false;
    };

    const handleMouseUp = () => {
        isDragging.current = false;
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging.current || !tabsRef.current) return;
        e.preventDefault();
        const x = e.pageX - tabsRef.current.offsetLeft;
        const walk = (x - startX.current) * 2; // Scroll-fast
        tabsRef.current.scrollLeft = scrollLeft.current - walk;
    };

    // ── Drag and Drop for Commands ──
    const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        // Optional: Set drag image if needed, default is usually fine
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault(); // Necessary to allow dropping
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
        e.preventDefault();
        if (draggedIndex === null || draggedIndex === dropIndex || !askGeminiCommands) return;

        const newCommands = [...askGeminiCommands];
        const [movedItem] = newCommands.splice(draggedIndex, 1);
        newCommands.splice(dropIndex, 0, movedItem);

        onAskGeminiCommandsChange(newCommands);
        setDraggedIndex(null);
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
    };

    if (!isOpen) return null;

    return (
        <div className="settings-modal-overlay">
            <div className="settings-modal" style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
                <div className="settings-header" onMouseDown={onHeaderMouseDown}>
                    <h2>Settings</h2>
                    <button className="close-btn" onClick={handleClose}>✕</button>
                </div>

                <div
                    className="settings-tabs"
                    ref={tabsRef}
                    onMouseDown={handleMouseDown}
                    onMouseLeave={handleMouseLeave}
                    onMouseUp={handleMouseUp}
                    onMouseMove={handleMouseMove}
                >
                    <button
                        className={`settings-tab ${activeTab === 'appearance' ? 'active' : ''}`}
                        onClick={() => setActiveTab('appearance')}
                    >
                        Appearance
                    </button>
                    <button
                        className={`settings-tab ${activeTab === 'network' ? 'active' : ''}`}
                        onClick={() => setActiveTab('network')}
                    >
                        Network
                    </button>
                    <button
                        className={`settings-tab ${activeTab === 'system' ? 'active' : ''}`}
                        onClick={() => setActiveTab('system')}
                    >
                        System
                    </button>
                    <button
                        className={`settings-tab ${activeTab === 'ai' ? 'active' : ''}`}
                        onClick={() => setActiveTab('ai')}
                    >
                        AI
                    </button>
                    <button
                        className={`settings-tab ${activeTab === 'about' ? 'active' : ''}`}
                        onClick={() => setActiveTab('about')}
                    >
                        About
                    </button>
                </div>

                <div className="settings-content">
                    {activeTab === 'appearance' && (
                        <>
                            <div className="form-group">
                                <label>Theme</label>
                                <div style={{ display: 'flex', gap: '15px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal' }}>
                                        <input
                                            type="radio"
                                            name="theme"
                                            value="dark"
                                            checked={theme === 'dark'}
                                            onChange={() => onThemeChange('dark')}
                                            style={{ marginRight: '6px' }}
                                        />
                                        Dark
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal' }}>
                                        <input
                                            type="radio"
                                            name="theme"
                                            value="medium"
                                            checked={theme === 'medium'}
                                            onChange={() => onThemeChange('medium')}
                                            style={{ marginRight: '6px' }}
                                        />
                                        Medium
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal' }}>
                                        <input
                                            type="radio"
                                            name="theme"
                                            value="light"
                                            checked={theme === 'light'}
                                            onChange={() => onThemeChange('light')}
                                            style={{ marginRight: '6px' }}
                                        />
                                        Light
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal' }}>
                                        <input
                                            type="radio"
                                            name="theme"
                                            value="custom"
                                            checked={theme === 'custom'}
                                            onChange={() => onThemeChange('custom')}
                                            style={{ marginRight: '6px' }}
                                        />
                                        Custom
                                    </label>
                                </div>
                            </div>

                            {theme === 'custom' && (
                                <div className="form-group">
                                    <label>Colors (Custom Theme)</label>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                                        <div>
                                            <label style={{ fontSize: '0.9em', color: '#ccc' }}>Terminal Text</label>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <input
                                                    type="color"
                                                    value={terminalForeground}
                                                    onChange={(e) => onTerminalForegroundChange(e.target.value)}
                                                    style={{ border: 'none', width: '30px', height: '30px', cursor: 'pointer', padding: 0, backgroundColor: 'transparent' }}
                                                />
                                                <input
                                                    type="text"
                                                    value={terminalForeground}
                                                    onChange={(e) => onTerminalForegroundChange(e.target.value)}
                                                    className="settings-input"
                                                    style={{ width: '80px', padding: '4px', fontSize: '12px' }}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.9em', color: '#ccc' }}>Active Background</label>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <input
                                                    type="color"
                                                    value={terminalBackground}
                                                    onChange={(e) => onTerminalBackgroundChange(e.target.value)}
                                                    style={{ border: 'none', width: '30px', height: '30px', cursor: 'pointer', padding: 0, backgroundColor: 'transparent' }}
                                                />
                                                <input
                                                    type="text"
                                                    value={terminalBackground}
                                                    onChange={(e) => onTerminalBackgroundChange(e.target.value)}
                                                    className="settings-input"
                                                    style={{ width: '80px', padding: '4px', fontSize: '12px' }}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.9em', color: '#ccc' }}>Inactive Background</label>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <input
                                                    type="color"
                                                    value={terminalBackgroundInactive}
                                                    onChange={(e) => onTerminalBackgroundInactiveChange(e.target.value)}
                                                    style={{ border: 'none', width: '30px', height: '30px', cursor: 'pointer', padding: 0, backgroundColor: 'transparent' }}
                                                />
                                                <input
                                                    type="text"
                                                    value={terminalBackgroundInactive}
                                                    onChange={(e) => onTerminalBackgroundInactiveChange(e.target.value)}
                                                    className="settings-input"
                                                    style={{ width: '80px', padding: '4px', fontSize: '12px' }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="form-group">
                                <label>Empty Pane Background</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', gap: '10px', fontSize: '12px', color: '#ccc' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal' }}>
                                            <input
                                                type="radio"
                                                checked={paneBackgroundMode === 'image'}
                                                onChange={() => onPaneBackgroundModeChange('image')}
                                                style={{ marginRight: '6px' }}
                                            /> Image
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal' }}>
                                            <input
                                                type="radio"
                                                checked={paneBackgroundMode === 'color'}
                                                onChange={() => onPaneBackgroundModeChange('color')}
                                                style={{ marginRight: '6px' }}
                                            /> Color
                                        </label>
                                    </div>

                                    {paneBackgroundMode === 'color' ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <input
                                                type="color"
                                                value={paneBackground}
                                                onChange={(e) => onPaneBackgroundChange(e.target.value)}
                                                style={{ border: 'none', width: '30px', height: '30px', cursor: 'pointer', padding: 0, backgroundColor: 'transparent' }}
                                            />
                                            <input
                                                type="text"
                                                value={paneBackground}
                                                onChange={(e) => onPaneBackgroundChange(e.target.value)}
                                                className="settings-input"
                                                style={{ width: '80px', padding: '4px', fontSize: '12px' }}
                                            />
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <input
                                                type="text"
                                                value={paneBackgroundImage}
                                                onChange={(e) => onPaneBackgroundImageChange(e.target.value)}
                                                placeholder="/bg-cyberspace.svg"
                                                className="settings-input"
                                                style={{ flex: 1, padding: '4px', fontSize: '12px' }}
                                            />
                                            <button
                                                onClick={async () => {
                                                    const path = await window.electronAPI.selectImage();
                                                    if (path) {
                                                        const url = `media:///${path.replace(/\\/g, '/')}`;
                                                        onPaneBackgroundImageChange(url);
                                                    }
                                                }}
                                                style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer' }}
                                            >
                                                Browse...
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Font Family</label>
                                <select
                                    value={fontFamily}
                                    onChange={(e) => onFontFamilyChange(e.target.value)}
                                    className="settings-select"
                                >
                                    <option value='Consolas, "Courier New", monospace'>Consolas / Courier New</option>
                                    <option value='"Cascadia Code", "Fira Code", monospace'>Cascadia / Fira Code</option>
                                    <option value='"MesloLGS NF", "DejaVu Sans Mono", monospace'>MesloLGS NF / DejaVu</option>
                                    <option value="monospace">System Monospace</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label>Font Size</label>
                                <input
                                    type="number"
                                    value={fontSize}
                                    onChange={(e) => onFontSizeChange(parseInt(e.target.value, 10))}
                                    className="settings-input"
                                    min={8}
                                    max={72}
                                />
                            </div>

                            <div className="form-group">
                                <label>Default Encoding</label>
                                <select
                                    value={encoding}
                                    onChange={(e) => onEncodingChange(e.target.value)}
                                    className="settings-select"
                                >
                                    <option value="utf8">UTF-8</option>
                                    <option value="shift_jis">Shift_JIS</option>
                                    <option value="euc-jp">EUC-JP</option>
                                </select>
                                <p className="settings-help">Applies to new connections.</p>
                            </div>
                        </>
                    )}

                    {activeTab === 'network' && (
                        <div className="form-group">
                            <label>SSH KeepAlive</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal' }}>
                                    <input
                                        type="checkbox"
                                        checked={sshKeepAliveEnabled}
                                        onChange={(e) => onSshKeepAliveEnabledChange(e.target.checked)}
                                        style={{ marginRight: '8px' }}
                                    />
                                    Enable
                                </label>
                            </div>
                            {sshKeepAliveEnabled && (
                                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontSize: '0.9em', color: '#ccc' }}>Interval (seconds):</span>
                                    <input
                                        type="number"
                                        value={sshKeepAliveInterval}
                                        onChange={(e) => onSshKeepAliveIntervalChange(parseInt(e.target.value, 10))}
                                        className="settings-input"
                                        min={5}
                                        max={300}
                                        style={{ width: '80px' }}
                                    />
                                </div>
                            )}
                            <p className="settings-help">Sends dummy packets to prevent timeouts.</p>
                        </div>
                    )}

                    {activeTab === 'system' && (
                        <div className="form-group">
                            <label>Logging</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal', whiteSpace: 'nowrap' }}>
                                    <input
                                        type="checkbox"
                                        checked={loggingEnabled}
                                        onChange={(e) => onLoggingEnabledChange(e.target.checked)}
                                        style={{ marginRight: '8px' }}
                                    />
                                    Enable Logging
                                </label>
                            </div>
                            {loggingEnabled && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                    <label style={{ fontSize: '0.9em', color: '#ccc' }}>Log Folder Path</label>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <input
                                            type="text"
                                            value={loggingPath}
                                            onChange={(e) => onLoggingPathChange(e.target.value)}
                                            className="settings-input"
                                            style={{ flex: 1, padding: '4px', fontSize: '12px' }}
                                            placeholder="Select a folder or type path..."
                                        />
                                        <button
                                            onClick={async () => {
                                                const path = await window.electronAPI.selectFolder();
                                                if (path) {
                                                    onLoggingPathChange(path);
                                                }
                                            }}
                                            style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer' }}
                                        >
                                            Browse...
                                        </button>
                                    </div>
                                    <p className="settings-help">Logs are saved as YYYYMMDDHHMMSS-(Protocol)-(IP).txt</p>
                                </div>
                            )}

                            <div className="form-group" style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--border-color)' }}>
                                <label>Local Log Buffer</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <input
                                        type="number"
                                        value={scrollback}
                                        onChange={(e) => onScrollbackChange(parseInt(e.target.value, 10))}
                                        className="settings-input"
                                        min={100}
                                        max={100000}
                                        style={{ width: '100px' }}
                                    />
                                    <span style={{ fontSize: '0.9em', color: '#ccc' }}>lines</span>
                                </div>
                                <p className="settings-help">Max lines to keep in memory per terminal (Default: 10000).</p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'ai' && (
                        <div className="form-group">
                            <label style={{ marginBottom: '10px', display: 'block' }}>Ask Gemini Commands</label>

                            <div className="command-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                                {askGeminiCommands?.map((cmd, index) => (
                                    <div
                                        key={cmd.id}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, index)}
                                        onDragOver={(e) => handleDragOver(e)}
                                        onDrop={(e) => handleDrop(e, index)}
                                        onDragEnd={handleDragEnd}
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
                                            <span style={{ cursor: 'grab', color: '#888', fontSize: '16px', userSelect: 'none' }}>☰</span>
                                            <input
                                                type="text"
                                                value={cmd.label}
                                                onChange={(e) => {
                                                    const newCommands = [...askGeminiCommands];
                                                    newCommands[index] = { ...cmd, label: e.target.value };
                                                    onAskGeminiCommandsChange(newCommands);
                                                }}
                                                placeholder="Label"
                                                className="settings-input"
                                                style={{ flex: 1, padding: '4px', fontSize: '13px' }}
                                            />
                                            <button
                                                onClick={() => {
                                                    const newCommands = askGeminiCommands.filter((_, i) => i !== index);
                                                    onAskGeminiCommandsChange(newCommands);
                                                }}
                                                style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer', backgroundColor: '#d32f2f', color: 'white', border: 'none', borderRadius: '3px' }}
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        <textarea
                                            value={cmd.promptTemplate}
                                            onChange={(e) => {
                                                const newCommands = [...askGeminiCommands];
                                                newCommands[index] = { ...cmd, promptTemplate: e.target.value };
                                                onAskGeminiCommandsChange(newCommands);
                                            }}
                                            placeholder="Prompt Template ({selection} will be replaced)"
                                            className="settings-input"
                                            style={{
                                                width: '100%',
                                                padding: '6px',
                                                fontSize: '12px',
                                                height: '60px',
                                                fontFamily: 'monospace',
                                                resize: 'vertical',
                                                boxSizing: 'border-box' // Fix overflow
                                            }}
                                        />
                                        <div style={{ fontSize: '10px', color: '#888' }}>
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
                                        onAskGeminiCommandsChange([...(askGeminiCommands || []), newCommand]);
                                    }}
                                    style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
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
                                            onAskGeminiCommandsChange(DEFAULT_COMMANDS);
                                        }
                                    }}
                                    style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
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
                                                    style={{ flex: 1, padding: '4px', fontSize: '13px' }}
                                                />
                                                <button
                                                    onClick={() => {
                                                        if (confirm('Delete this persona?')) {
                                                            const newPersonas = aiPersonas.filter((_, i) => i !== index);
                                                            onAiPersonasChange(newPersonas);
                                                        }
                                                    }}
                                                    style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer', backgroundColor: '#d32f2f', color: 'white', border: 'none', borderRadius: '3px' }}
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
                                                    fontSize: '12px',
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
                                        style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
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
                                        style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
                                    >
                                        Reset Defaults
                                    </button>
                                </div>
                                <p className="settings-help">The default system instruction sent to Gemini when starting a new session.</p>
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
                        </div>
                    )}

                    {activeTab === 'about' && (
                        <div className="about-content" style={{ textAlign: 'center', padding: '20px 0' }}>
                            <img src="/icon.png" alt="HoTTY Logo" width="64" height="64" style={{ marginBottom: '16px', background: 'white', borderRadius: '12px', padding: '4px' }} />
                            <h2 style={{ margin: '0 0 8px 0' }}>HoTTY</h2>
                            <p style={{ color: '#aaa', margin: '0 0 24px 0' }}>v{version}</p>
                            <p style={{ fontSize: '0.9em', color: '#666' }}>
                                SSH/Telnet/Serial Terminal Emulator<br />
                                Built with Electron, React, & TypeScript
                            </p>
                            <p style={{ fontSize: '0.8em', color: '#444', marginTop: '32px' }}>
                                Copyright © 2026 HoTTY Contributors
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
