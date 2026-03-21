import React, { useEffect, useRef } from 'react';
import { useDraggable } from '../../hooks/useDraggable';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { AppearanceTab } from './AppearanceTab';
import { SSHSettingsTab } from './SSHSettingsTab';
import { AISettingsTab } from './AISettingsTab';
import * as electronService from '../../services/electronService';
import type { PersonaDefinition } from '../../types/appTypes';
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
    telnetKeepAliveEnabled: boolean;
    onTelnetKeepAliveEnabledChange: (enabled: boolean) => void;
    telnetKeepAliveInterval: number;
    onTelnetKeepAliveIntervalChange: (interval: number) => void;
    themesData: Record<string, { name?: string; variables?: Record<string, string>; terminal?: Record<string, string> }> | null;
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
    theme: string;
    onThemeChange: (theme: string) => void;
    onOpenCustomThemeCreator: () => void;
    onDeleteTheme: (theme: string) => void;
    sidebarPosition: 'left' | 'right';
    onSidebarPositionChange: (position: 'left' | 'right') => void;
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
    updateInfo?: { version: string; releaseUrl: string } | null;
    // AI Settings props
    onAiLogout: () => void;
    showSystemPrompt: boolean;
    onShowSystemPromptChange: (show: boolean) => void;
    aiPersonas: PersonaDefinition[];
    onAiPersonasChange: (personas: PersonaDefinition[]) => void;
    activePersonaId: string;
    onActivePersonaIdChange: (id: string) => void;
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
    themesData,
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
    onOpenCustomThemeCreator,
    onDeleteTheme,
    sidebarPosition,
    onSidebarPositionChange,
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
    updateInfo,
    onAiLogout,
    showSystemPrompt,
    onShowSystemPromptChange,
    aiPersonas,
    onAiPersonasChange,
    activePersonaId,
    onActivePersonaIdChange,
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
    const [sshAlgorithms, setSshAlgorithms] = React.useState<Record<string, { name: string; enabled: boolean }[]> | null>(null);
    const [isAiAuthenticated, setIsAiAuthenticated] = React.useState<boolean>(false);
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
            electronService.aiAuthStatus().then(setIsAiAuthenticated);
        }
    }, [isOpen]);

    // ── Drag and Drop for AI Commands ──
    const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);

    const handleCommandDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleCommandDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleCommandDrop = (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
        e.preventDefault();
        const activePersona = aiPersonas.find(p => p.id === activePersonaId) ?? aiPersonas[0];
        if (draggedIndex === null || draggedIndex === dropIndex || !activePersona) return;

        const newCommands = [...activePersona.askAiCommands];
        const [movedItem] = newCommands.splice(draggedIndex, 1);
        newCommands.splice(dropIndex, 0, movedItem);

        const newPersonas = aiPersonas.map(p =>
            p.id === activePersona.id ? { ...p, askAiCommands: newCommands } : p
        );
        onAiPersonasChange(newPersonas);
        setDraggedIndex(null);
    };

    const handleCommandDragEnd = () => {
        setDraggedIndex(null);
    };

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
        newAlgorithms[category] = newAlgorithms[category].map((algo) =>
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
                            onOpenCustomThemeCreator={onOpenCustomThemeCreator}
                            onDeleteTheme={onDeleteTheme}
                            themesData={themesData as Record<string, { name: string; variables: Record<string, string>; terminal: Record<string, string> }> | null}
                            sidebarPosition={sidebarPosition}
                            onSidebarPositionChange={onSidebarPositionChange}
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
                            sshAlgorithms={sshAlgorithms ?? {}}
                            onAlgorithmToggle={handleAlgorithmToggle}
                        />
                    )}

                    {activeTab === 'ai' && (
                        <AISettingsTab
                            isAiAuthenticated={isAiAuthenticated}
                            onAuthenticatedChange={setIsAiAuthenticated}
                            onLogout={onAiLogout}
                            watchBufferLimit={watchBufferLimit}
                            onWatchBufferLimitChange={onWatchBufferLimitChange}
                            interactiveStabilizationTimeout={interactiveStabilizationTimeout}
                            onInteractiveStabilizationTimeoutChange={onInteractiveStabilizationTimeoutChange}
                            aiPersonas={aiPersonas}
                            onAiPersonasChange={onAiPersonasChange}
                            activePersonaId={activePersonaId}
                            onActivePersonaIdChange={onActivePersonaIdChange}
                            proactiveInstruction={proactiveInstruction}
                            onProactiveInstructionChange={onProactiveInstructionChange}
                            showSystemPrompt={showSystemPrompt}
                            onShowSystemPromptChange={onShowSystemPromptChange}
                            draggedIndex={draggedIndex}
                            onDragStart={handleCommandDragStart}
                            onDragOver={handleCommandDragOver}
                            onDrop={handleCommandDrop}
                            onDragEnd={handleCommandDragEnd}
                        />
                    )}

                    {activeTab === 'about' && (
                        <div className="about-content" style={{ textAlign: 'center', padding: '20px 0' }}>
                            <img src="./HoTTY_logo.png" alt="HoTTY Logo" width="64" height="64" style={{ marginBottom: '16px', borderRadius: '12px', backgroundColor: '#fff', padding: '4px' }} />
                            <h2 style={{ margin: '0 0 8px 0' }}>HoTTY</h2>
                            <p style={{ color: 'var(--text-secondary)', margin: '0 0 8px 0' }}>v{version}</p>

                            {updateInfo && (
                                <div style={{ margin: '0 0 16px 0' }}>
                                    <button
                                        className="about-download-btn"
                                        onClick={() => electronService.openExternal(updateInfo.releaseUrl)}
                                    >
                                        &#8595; Download v{updateInfo.version}
                                    </button>
                                </div>
                            )}

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
                                    style={{ color: 'var(--link-color)', textDecoration: 'none' }}
                                >
                                    https://github.com/horryworks/HoTTY
                                </a>
                            </p>

                            <p style={{ color: 'var(--text-secondary)', margin: '0 0 24px 0' }}>
                                SSH/Telnet/Serial Terminal Emulator<br />
                                Built with Electron, React, & TypeScript
                            </p>

                            <p style={{ color: 'var(--text-tertiary)', margin: '0 0 8px 0', lineHeight: '1.4' }}>
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
                                    style={{ color: 'var(--link-color)', textDecoration: 'none' }}
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
