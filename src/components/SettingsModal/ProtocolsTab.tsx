import React from 'react';
import type { ProtocolId } from '../../types/appTypes';
import HelpTooltip from '../HelpTooltip/HelpTooltip';

const PROTOCOL_LABELS: { id: ProtocolId; label: string; description: string }[] = [
    { id: 'ssh', label: 'SSH', description: 'Secure Shell connections' },
    { id: 'telnet', label: 'Telnet', description: 'Telnet connections' },
    { id: 'serial', label: 'Serial', description: 'Serial port connections' },
    { id: 'wsl', label: 'WSL', description: 'Windows Subsystem for Linux' },
    { id: 'cmd', label: 'Command Prompt', description: 'Windows Command Prompt' },
    { id: 'powershell', label: 'PowerShell', description: 'Windows PowerShell' },
    { id: 'git-bash', label: 'Git Bash', description: 'Git Bash shell' },
];

interface ProtocolsTabProps {
    enabledProtocols: Record<ProtocolId, boolean>;
    onProtocolToggle: (protocol: ProtocolId, enabled: boolean) => void;
    sshKeepAliveEnabled: boolean;
    onSshKeepAliveEnabledChange: (enabled: boolean) => void;
    sshKeepAliveInterval: number;
    onSshKeepAliveIntervalChange: (interval: number) => void;
    telnetKeepAliveEnabled: boolean;
    onTelnetKeepAliveEnabledChange: (enabled: boolean) => void;
    telnetKeepAliveInterval: number;
    onTelnetKeepAliveIntervalChange: (interval: number) => void;
    sshAlgorithms: Record<string, { name: string; enabled: boolean }[]>;
    onAlgorithmToggle: (category: string, name: string) => void;
}

export const ProtocolsTab: React.FC<ProtocolsTabProps> = ({
    enabledProtocols,
    onProtocolToggle,
    sshKeepAliveEnabled,
    onSshKeepAliveEnabledChange,
    sshKeepAliveInterval,
    onSshKeepAliveIntervalChange,
    telnetKeepAliveEnabled,
    onTelnetKeepAliveEnabledChange,
    telnetKeepAliveInterval,
    onTelnetKeepAliveIntervalChange,
    sshAlgorithms,
    onAlgorithmToggle,
}) => {
    return (
        <>
            <div className="form-group">
                <label>Protocols <HelpTooltip text="Enable or disable connection protocols shown in the session dialog." /></label>
            </div>
            {PROTOCOL_LABELS.map(({ id, label, description }) => (
                <div key={id} style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'normal' }} title={description}>
                        <input
                            type="checkbox"
                            checked={enabledProtocols[id]}
                            onChange={(e) => onProtocolToggle(id, e.target.checked)}
                            style={{ marginRight: '8px' }}
                        />
                        {label}
                    </label>
                </div>
            ))}

            {enabledProtocols.ssh && (
                <div className="form-group" style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--border-color)' }}>
                    <label>SSH KeepAlive <HelpTooltip text="Sends dummy packets to prevent timeouts." /></label>
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
                            <span style={{ color: 'var(--text-secondary)' }}>Interval (seconds):</span>
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

                    {sshAlgorithms && (
                        <details style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '15px' }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '10px' }}>SSH Algorithms <HelpTooltip text="Choose which algorithms to enable for SSH connections. Changes apply to new sessions." /></summary>
                            <div className="ssh-algorithms-container" style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '10px' }}>
                                {Object.keys(sshAlgorithms).map(category => (
                                    <div key={category} style={{ marginBottom: '15px' }}>
                                        <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                                            {category === 'serverHostKey' ? 'Server Host Key' : category}
                                        </h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
                                            {sshAlgorithms[category].map((algo) => (
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
                        </details>
                    )}
                </div>
            )}

            {enabledProtocols.telnet && (
                <div className="form-group" style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid var(--border-color)' }}>
                    <label>Telnet KeepAlive <HelpTooltip text="Sends Telnet NOP commands to prevent idle timeouts." /></label>
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
                            <span style={{ color: 'var(--text-secondary)' }}>Interval (seconds):</span>
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
                </div>
            )}
        </>
    );
};
