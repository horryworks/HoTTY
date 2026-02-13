import React from 'react';
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
    paneBackground: string;
    onPaneBackgroundChange: (color: string) => void;
    paneBackgroundMode: 'color' | 'image';
    onPaneBackgroundModeChange: (mode: 'color' | 'image') => void;
    paneBackgroundImage: string;
    onPaneBackgroundImageChange: (url: string) => void;
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
    paneBackground,
    onPaneBackgroundChange,
    paneBackgroundMode,
    onPaneBackgroundModeChange,
    paneBackgroundImage,
    onPaneBackgroundImageChange
}) => {
    if (!isOpen) return null;

    return (
        <div className="settings-modal-overlay">
            <div className="settings-modal">
                <div className="settings-header">
                    <h2>Settings</h2>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>
                <div className="settings-content">
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
                            style={{ padding: '8px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: '#eee' }}
                        />
                    </div>

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
                                    style={{ width: '80px', padding: '4px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: '#eee' }}
                                />
                            </div>
                        )}
                        <p className="settings-help">Sends dummy packets to prevent timeouts.</p>
                    </div>

                    <div className="form-group">
                        <label>Colors</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
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
                                <label style={{ fontSize: '0.9em', color: '#ccc' }}>Terminal Background</label>
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
                                <label style={{ fontSize: '0.9em', color: '#ccc' }}>Empty Pane Background</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', gap: '10px', fontSize: '12px', color: '#ccc' }}>
                                        <label>
                                            <input
                                                type="radio"
                                                checked={paneBackgroundMode === 'image'}
                                                onChange={() => onPaneBackgroundModeChange('image')}
                                            /> Image
                                        </label>
                                        <label>
                                            <input
                                                type="radio"
                                                checked={paneBackgroundMode === 'color'}
                                                onChange={() => onPaneBackgroundModeChange('color')}
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
                                                        // Convert local path to file URL-like format or just use path if valid (browsers might block local file access from http)
                                                        // But Electron usually handles local files if webSecurity is managed or via protocol
                                                        // However, easier to just set it. If it fails, we might need a custom protocol.
                                                        // Use Custom Protocol 'media://' to bypass browser restrictions
                                                        // Use 3 slashes for better path handling consistency
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
                        </div>
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
                </div>
            </div>
        </div>
    );
};
