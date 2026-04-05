import React from 'react';
import * as electronService from '../../services/electronService';

interface GeneralTabProps {
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
}

export const GeneralTab: React.FC<GeneralTabProps> = ({
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
}) => {
    return (
        <div className="form-group">
            <h3 style={{ margin: '0 0 12px 0', fontSize: 'calc(var(--font-size-base) + 2px)', color: 'var(--text-primary)' }}>Storage</h3>
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
                    <label style={{ color: 'var(--text-secondary)' }}>Log Folder Path</label>
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
                <label>Terminal Scrollback Buffer</label>
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
                    <span style={{ color: 'var(--text-secondary)' }}>lines</span>
                </div>
                <p className="settings-help">Max lines to keep in memory per terminal (Default: 10000).</p>
            </div>

            <h3 style={{ margin: '15px 0 12px 0', paddingTop: '15px', borderTop: '1px solid var(--border-color)', fontSize: 'calc(var(--font-size-base) + 2px)', color: 'var(--text-primary)' }}>Input</h3>
            <div className="form-group">
                <label>Keyboard</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal', whiteSpace: 'nowrap' }}>
                        <input
                            type="checkbox"
                            checked={backspaceSendsDel}
                            onChange={(e) => onBackspaceSendsDelChange(e.target.checked)}
                            style={{ marginRight: '8px' }}
                        />
                        Backspace sends DEL (0x7F)
                    </label>
                </div>
                <p className="settings-help">If disabled (default), Backspace sends 0x08 (BS/^H). Enable this if your server expects 0x7F (DEL) for Backspace.</p>
            </div>

            <div className="form-group" style={{ marginTop: '10px' }}>
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

            <h3 style={{ margin: '15px 0 12px 0', paddingTop: '15px', borderTop: '1px solid var(--border-color)', fontSize: 'calc(var(--font-size-base) + 2px)', color: 'var(--text-primary)' }}>Diagnostics</h3>
            <div className="form-group">
                <label>Debug Log</label>
                <div>
                    <button
                        className="settings-button"
                        onClick={() => electronService.openDebugLogFolder()}
                    >
                        Open Debug Log Folder
                    </button>
                </div>
                <p className="settings-help">Application debug logs are saved here. Share the latest log file when reporting a bug.</p>
            </div>
        </div>
    );
};
