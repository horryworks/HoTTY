import React, { useEffect, useRef } from 'react';
import { useDraggable } from '../../hooks/useDraggable';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { AppearanceTab } from './AppearanceTab';
import { SSHSettingsTab } from './SSHSettingsTab';
import { AISettingsTab } from './AISettingsTab';
import * as electronService from '../../services/electronService';
import './SettingsModal.css';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onLogout: () => void;
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
    telnetKeepAliveEnabled: boolean;
    onTelnetKeepAliveEnabledChange: (enabled: boolean) => void;
    telnetKeepAliveInterval: number;
    onTelnetKeepAliveIntervalChange: (interval: number) => void;
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
    sidebarPosition: 'left' | 'right';
    onSidebarPositionChange: (position: 'left' | 'right') => void;
    showSystemPrompt: boolean;
    onShowSystemPromptChange: (show: boolean) => void;
    askGeminiCommands: { id: string; label: string; promptTemplate: string }[];
    onAskGeminiCommandsChange: (commands: { id: string; label: string; promptTemplate: string }[]) => void;
    aiPersonas: { id: string; label: string; systemPrompt: string }[];
    onAiPersonasChange: (personas: { id: string; label: string; systemPrompt: string }[]) => void;
    backspaceSendsDel: boolean;
    onBackspaceSendsDelChange: (sendsDel: boolean) => void;
    rightClickPaste: boolean;
    onRightClickPasteChange: (enabled: boolean) => void;
    enablePromptHighlight: boolean;
    onEnablePromptHighlightChange: (enabled: boolean) => void;
    promptHighlightColor: string;
    onPromptHighlightColorChange: (color: string) => void;
    promptPatterns: { id: string; name: string; pattern: string; enabled: boolean }[];
    onPromptPatternsChange: (patterns: { id: string; name: string; pattern: string; enabled: boolean }[]) => void;
    watchBufferLimit: number;
    onWatchBufferLimitChange: (limit: number) => void;
    proactiveInstruction: string;
    onProactiveInstructionChange: (instruction: string) => void;
    interactiveStabilizationTimeout: number;
    onInteractiveStabilizationTimeoutChange: (timeout: number) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
    isOpen,
    onClose,
    onLogout,
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
    telnetKeepAliveEnabled,
    onTelnetKeepAliveEnabledChange,
    telnetKeepAliveInterval,
    onTelnetKeepAliveIntervalChange,
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
    sidebarPosition,
    onSidebarPositionChange,
    showSystemPrompt,
    onShowSystemPromptChange,
    askGeminiCommands,
    onAskGeminiCommandsChange,
    aiPersonas,
    onAiPersonasChange,
    backspaceSendsDel,
    onBackspaceSendsDelChange,
    rightClickPaste,
    onRightClickPasteChange,
    enablePromptHighlight,
    onEnablePromptHighlightChange,
    promptHighlightColor,
    onPromptHighlightColorChange,
    promptPatterns,
    onPromptPatternsChange,
    watchBufferLimit,
    onWatchBufferLimitChange,
    proactiveInstruction,
    onProactiveInstructionChange,
    interactiveStabilizationTimeout,
    onInteractiveStabilizationTimeoutChange,
}) => {
    const { position, onMouseDown: onHeaderMouseDown } = useDraggable();
    const [activeTab, setActiveTab] = React.useState<'appearance' | 'ssh' | 'telnet' | 'system' | 'ai' | 'about'>('system');
    const [version, setVersion] = React.useState<string>('');
    const [isAiAuthenticated, setIsAiAuthenticated] = React.useState<boolean>(false);
    const [sshAlgorithms, setSshAlgorithms] = React.useState<any>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    // Focus trap inside modal
    useFocusTrap(modalRef, isOpen);

    // Auto-focus close button on open
    useEffect(() => {
        if (isOpen && closeButtonRef.current) {
            closeButtonRef.current.focus();
        }
    }, [isOpen]);

    React.useEffect(() => {
        if (isOpen) {
            electronService.getAppVersion().then(setVersion);
            electronService.getSshAlgorithms().then(setSshAlgorithms);
            electronService.geminiAuthStatus().then(setIsAiAuthenticated);
        }
    }, [isOpen]);

    // Close on Escape key
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                handleClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, loggingEnabled, loggingPath]);

    const handleClose = () => {
        if (loggingEnabled && !loggingPath) {
            alert('Logging is enabled but no folder path is selected.\nPlease select a folder or disable logging.');
            setActiveTab('system'); // Switch to system tab so user can see the error
            return;
        }
        onClose();
    };

    const handleAlgorithmToggle = async (category: string, name: string) => {
        if (!sshAlgorithms) return;
        const newAlgorithms = { ...sshAlgorithms };
        newAlgorithms[category] = newAlgorithms[category].map((algo: any) =>
            algo.name === name ? { ...algo, enabled: !algo.enabled } : algo
        );
        setSshAlgorithms(newAlgorithms);
        await electronService.saveSshAlgorithms(newAlgorithms);
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
            <div className="settings-modal" ref={modalRef} style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
                <div className="settings-header" onMouseDown={onHeaderMouseDown}>
                    <h2>Settings</h2>
                    <button className="close-btn" ref={closeButtonRef} onClick={handleClose}>✕</button>
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
                        className={`settings-tab ${activeTab === 'system' ? 'active' : ''}`}
                        onClick={() => setActiveTab('system')}
                    >
                        System
                    </button>
                    <button
                        className={`settings-tab ${activeTab === 'appearance' ? 'active' : ''}`}
                        onClick={() => setActiveTab('appearance')}
                    >
                        Appearance
                    </button>
                    <button
                        className={`settings-tab ${activeTab === 'ssh' ? 'active' : ''}`}
                        onClick={() => setActiveTab('ssh')}
                    >
                        SSH
                    </button>
                    <button
                        className={`settings-tab ${activeTab === 'telnet' ? 'active' : ''}`}
                        onClick={() => setActiveTab('telnet')}
                    >
                        Telnet
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
                        <AppearanceTab
                            theme={theme}
                            onThemeChange={onThemeChange}
                            sidebarPosition={sidebarPosition}
                            onSidebarPositionChange={onSidebarPositionChange}
                            terminalForeground={terminalForeground}
                            onTerminalForegroundChange={onTerminalForegroundChange}
                            terminalBackground={terminalBackground}
                            onTerminalBackgroundChange={onTerminalBackgroundChange}
                            terminalBackgroundInactive={terminalBackgroundInactive}
                            onTerminalBackgroundInactiveChange={onTerminalBackgroundInactiveChange}
                            paneBackground={paneBackground}
                            onPaneBackgroundChange={onPaneBackgroundChange}
                            paneBackgroundMode={paneBackgroundMode}
                            onPaneBackgroundModeChange={onPaneBackgroundModeChange}
                            paneBackgroundImage={paneBackgroundImage}
                            onPaneBackgroundImageChange={onPaneBackgroundImageChange}
                            fontFamily={fontFamily}
                            onFontFamilyChange={onFontFamilyChange}
                            fontSize={fontSize}
                            onFontSizeChange={onFontSizeChange}
                            encoding={encoding}
                            onEncodingChange={onEncodingChange}
                            enablePromptHighlight={enablePromptHighlight}
                            onEnablePromptHighlightChange={onEnablePromptHighlightChange}
                            promptHighlightColor={promptHighlightColor}
                            onPromptHighlightColorChange={onPromptHighlightColorChange}
                            promptPatterns={promptPatterns}
                            onPromptPatternsChange={onPromptPatternsChange}
                        />
                    )}

                    {(activeTab === 'ssh' || activeTab === 'telnet' || activeTab === 'system') && (
                        <SSHSettingsTab
                            activeTab={activeTab}
                            sshKeepAliveEnabled={sshKeepAliveEnabled}
                            onSshKeepAliveEnabledChange={onSshKeepAliveEnabledChange}
                            sshKeepAliveInterval={sshKeepAliveInterval}
                            onSshKeepAliveIntervalChange={onSshKeepAliveIntervalChange}
                            telnetKeepAliveEnabled={telnetKeepAliveEnabled}
                            onTelnetKeepAliveEnabledChange={onTelnetKeepAliveEnabledChange}
                            telnetKeepAliveInterval={telnetKeepAliveInterval}
                            onTelnetKeepAliveIntervalChange={onTelnetKeepAliveIntervalChange}
                            loggingEnabled={loggingEnabled}
                            onLoggingEnabledChange={onLoggingEnabledChange}
                            loggingPath={loggingPath}
                            onLoggingPathChange={onLoggingPathChange}
                            scrollback={scrollback}
                            onScrollbackChange={onScrollbackChange}
                            backspaceSendsDel={backspaceSendsDel}
                            onBackspaceSendsDelChange={onBackspaceSendsDelChange}
                            rightClickPaste={rightClickPaste}
                            onRightClickPasteChange={onRightClickPasteChange}
                            sshAlgorithms={sshAlgorithms}
                            onAlgorithmToggle={handleAlgorithmToggle}
                        />
                    )}

                    {activeTab === 'ai' && (
                        <AISettingsTab
                            isAiAuthenticated={isAiAuthenticated}
                            onAuthenticatedChange={setIsAiAuthenticated}
                            onLogout={onLogout}
                            watchBufferLimit={watchBufferLimit}
                            onWatchBufferLimitChange={onWatchBufferLimitChange}
                            interactiveStabilizationTimeout={interactiveStabilizationTimeout}
                            onInteractiveStabilizationTimeoutChange={onInteractiveStabilizationTimeoutChange}
                            askGeminiCommands={askGeminiCommands}
                            onAskGeminiCommandsChange={onAskGeminiCommandsChange}
                            aiPersonas={aiPersonas}
                            onAiPersonasChange={onAiPersonasChange}
                            proactiveInstruction={proactiveInstruction}
                            onProactiveInstructionChange={onProactiveInstructionChange}
                            showSystemPrompt={showSystemPrompt}
                            onShowSystemPromptChange={onShowSystemPromptChange}
                            draggedIndex={draggedIndex}
                            onDragStart={handleDragStart}
                            onDragOver={handleDragOver}
                            onDrop={handleDrop}
                            onDragEnd={handleDragEnd}
                        />
                    )}

                    {activeTab === 'about' && (
                        <div className="about-content" style={{ textAlign: 'center', padding: '20px 0' }}>
                            <img src="./HoTTY_logo.png" alt="HoTTY Logo" width="64" height="64" style={{ marginBottom: '16px', borderRadius: '12px', backgroundColor: '#fff', padding: '4px' }} />
                            <h2 style={{ margin: '0 0 8px 0' }}>HoTTY</h2>
                            <p style={{ color: '#aaa', margin: '0 0 16px 0' }}>v{version}</p>

                            <p style={{ fontWeight: 'bold', margin: '0 0 8px 0' }}>
                                Katsumasa "Horry" Horiuchi
                            </p>

                            <p style={{ margin: '0 0 16px 0' }}>
                                <a
                                    href="https://github.com/horryworks/HoTTY"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        electronService.openExternal('https://github.com/horryworks/HoTTY');
                                    }}
                                    style={{ color: '#64b5f6', textDecoration: 'none' }}
                                >
                                    https://github.com/horryworks/HoTTY
                                </a>
                            </p>

                            <p style={{ color: '#ccc', margin: '0 0 24px 0' }}>
                                SSH/Telnet/Serial Terminal Emulator<br />
                                Built with Electron, React, & TypeScript
                            </p>

                            <p style={{ color: '#888', margin: '0 0 8px 0', lineHeight: '1.4' }}>
                                This program is free software released under the<br />
                                GNU General Public License v3.0 or later.
                            </p>

                            <p style={{ margin: '16px 0 0 0' }}>
                                <a
                                    href="https://www.gnu.org/licenses/gpl-3.0.html"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        electronService.openExternal('https://www.gnu.org/licenses/gpl-3.0.html');
                                    }}
                                    style={{ color: '#64b5f6', textDecoration: 'none' }}
                                >
                                    View GNU General Public License v3.0
                                </a>
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
