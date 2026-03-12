import React from 'react';
import * as electronService from '../../services/electronService';

interface SSHSettingsTabProps {
    activeTab: 'ssh' | 'telnet' | 'system';
    sshKeepAliveEnabled: boolean;
    onSshKeepAliveEnabledChange: (enabled: boolean) => void;
    sshKeepAliveInterval: number;
    onSshKeepAliveIntervalChange: (interval: number) => void;
    telnetKeepAliveEnabled: boolean;
    onTelnetKeepAliveEnabledChange: (enabled: boolean) => void;
    telnetKeepAliveInterval: number;
    onTelnetKeepAliveIntervalChange: (interval: number) => void;
    loggingEnabled: boolean;
    onLoggingEnabledChange: (enabled: boolean) => void;
    loggingPath: string;
    onLoggingPathChange: (path: string) => void;
    scrollback: number;
    onScrollbackChange: (lines: number) => void;
    backspaceSendsDel: boolean;
    onBackspaceSendsDelChange: (sendsDel: boolean) => void;
    rightClickPaste: boolean;
    onRightClickPasteChange: (enabled: boolean) => void;
    sshAlgorithms: any;
    onAlgorithmToggle: (category: string, name: string) => void;
}

export const SSHSettingsTab: React.FC<SSHSettingsTabProps> = ({
    activeTab,
    sshKeepAliveEnabled,
    onSshKeepAliveEnabledChange,
    sshKeepAliveInterval,
    onSshKeepAliveIntervalChange,
    telnetKeepAliveEnabled,
    onTelnetKeepAliveEnabledChange,
    telnetKeepAliveInterval,
    onTelnetKeepAliveIntervalChange,
    loggingEnabled,
    onLoggingEnabledChange,
    loggingPath,
    onLoggingPathChange,
    scrollback,
    onScrollbackChange,
    backspaceSendsDel,
    onBackspaceSendsDelChange,
    rightClickPaste,
    onRightClickPasteChange,
    sshAlgorithms,
    onAlgorithmToggle,
}) => {
    if (activeTab === 'ssh') {
        return (
            <>
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
                            <span style={{ color: '#ccc' }}>Interval (seconds):</span>
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

                {sshAlgorithms && (
                    <div className="form-group" style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '15px' }}>
                        <label style={{ marginBottom: '10px', display: 'block' }}>SSH Algorithms</label>
                        <div className="ssh-algorithms-container" style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '10px' }}>
                            {Object.keys(sshAlgorithms).map(category => (
                                <div key={category} style={{ marginBottom: '15px' }}>
                                    <h4 style={{ margin: '0 0 8px 0', color: '#aaa', textTransform: 'capitalize' }}>
                                        {category === 'serverHostKey' ? 'Server Host Key' : category}
                                    </h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
                                        {sshAlgorithms[category].map((algo: any) => (
                                            <label key={algo.name} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px', alignItems: 'center', fontWeight: 'normal', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={algo.enabled}
                                                    onChange={() => onAlgorithmToggle(category, algo.name)}
                                                    style={{ margin: 0, padding: 0, cursor: 'pointer' }}
                                                />
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }} title={algo.name}>
                                                    {algo.name}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p className="settings-help">Choose which algorithms to enable for SSH connections. Changes apply to new sessions.</p>
                    </div>
                )}
            </>
        );
    }

    if (activeTab === 'telnet') {
        return (
            <>
                <div className="form-group">
                    <label>Telnet KeepAlive</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal' }}>
                            <input
                                type="checkbox"
                                checked={telnetKeepAliveEnabled}
                                onChange={(e) => onTelnetKeepAliveEnabledChange(e.target.checked)}
                                style={{ marginRight: '8px' }}
                            />
                            Enable
                        </label>
                    </div>
                    {telnetKeepAliveEnabled && (
                        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: '#ccc' }}>Interval (seconds):</span>
                            <input
                                type="number"
                                value={telnetKeepAliveInterval}
                                onChange={(e) => onTelnetKeepAliveIntervalChange(parseInt(e.target.value, 10))}
                                className="settings-input"
                                min={5}
                                max={300}
                                style={{ width: '80px' }}
                            />
                        </div>
                    )}
                    <p className="settings-help">Sends Telnet NOP commands to prevent idle timeouts.</p>
                </div>
            </>
        );
    }

    // activeTab === 'system'
    return (
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
                    <label style={{ color: '#ccc' }}>Log Folder Path</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                            type="text"
                            value={loggingPath}
                            onChange={(e) => onLoggingPathChange(e.target.value)}
                            className="settings-input"
                            style={{ flex: 1, padding: '4px' }}
                            placeholder="Select a folder or type path..."
                        />
                        <button
                            onClick={async () => {
                                const path = await electronService.selectFolder();
                                if (path) {
                                    onLoggingPathChange(path);
                                }
                            }}
                            style={{ padding: '4px 8px', cursor: 'pointer' }}
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
                    <span style={{ color: '#ccc' }}>lines</span>
                </div>
                <p className="settings-help">Max lines to keep in memory per terminal (Default: 10000).</p>
            </div>

            <div className="form-group" style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--border-color)' }}>
                <label>Keyboard</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal', whiteSpace: 'nowrap' }}>
                        <input
                            type="checkbox"
                            checked={backspaceSendsDel}
                            onChange={(e) => onBackspaceSendsDelChange(e.target.checked)}
                            style={{ marginRight: '8px' }}
                        />
                        Backspace sends 0x7F (DEL)
                    </label>
                </div>
                <p className="settings-help">If disabled (default), Backspace sends 0x08 (BS/^H). Enable this if your server expects 0x7F (DEL) for Backspace.</p>
            </div>

            <div className="form-group" style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--border-color)' }}>
                <label>Mouse</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal', whiteSpace: 'nowrap' }}>
                        <input
                            type="checkbox"
                            checked={rightClickPaste}
                            onChange={(e) => onRightClickPasteChange(e.target.checked)}
                            style={{ marginRight: '8px' }}
                        />
                        Right-click to paste
                    </label>
                </div>
                <p className="settings-help">If enabled, right-clicking the terminal will read the clipboard and show the paste confirmation dialog instead of the context menu.</p>
            </div>
        </div>
    );
};
