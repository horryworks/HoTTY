import React, { useState, useEffect } from 'react';
import './ConnectionDialog.css';

interface ConnectionDialogProps {
    onConnect: (config: any) => void;
    onClose: () => void;
    error?: string | null;
    getCachedPassword: (host: string, user: string) => string;
    saveCachedPassword: (host: string, user: string, pass: string) => void;
}

interface SerialPortInfo {
    path: string;
    manufacturer: string;
    pnpId: string;
}

export const ConnectionDialog: React.FC<ConnectionDialogProps> = ({
    onConnect,
    onClose,
    error,
    getCachedPassword,
    saveCachedPassword
}) => {
    const [history, setHistory] = useState<string[]>(() => {
        const saved = localStorage.getItem('hterm_host_history');
        return saved ? JSON.parse(saved) : [];
    });

    // Cache for usernames per host
    const [usernameMap, setUsernameMap] = useState<Record<string, string>>(() => {
        const saved = localStorage.getItem('hterm_username_map');
        return saved ? JSON.parse(saved) : {};
    });

    const [host, setHost] = useState(history.length > 0 ? history[0] : '');
    const [port, setPort] = useState('22');

    // Initialize username if the default host has a cached entry
    const [username, setUsername] = useState(() => {
        const defaultHost = history.length > 0 ? history[0] : '';
        return (defaultHost && usernameMap[defaultHost]) ? usernameMap[defaultHost] : '';
    });

    // Initialize password from memory cache
    const [password, setPassword] = useState(() => {
        const defaultHost = history.length > 0 ? history[0] : '';
        const defaultUser = (defaultHost && usernameMap[defaultHost]) ? usernameMap[defaultHost] : '';
        return getCachedPassword(defaultHost, defaultUser);
    });

    const [protocol, setProtocol] = useState('ssh');

    // Serial-specific state (Cisco defaults)
    const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
    const [serialPath, setSerialPath] = useState('');
    const [baudRate, setBaudRate] = useState('9600');
    const [dataBits, setDataBits] = useState('8');
    const [parity, setParity] = useState('none');
    const [stopBits, setStopBits] = useState('1');
    const [flowControl, setFlowControl] = useState('none');

    // Fetch serial ports when protocol is serial
    useEffect(() => {
        if (protocol === 'serial') {
            (window as any).electronAPI.listSerialPorts().then((ports: SerialPortInfo[]) => {
                setSerialPorts(ports);
                if (ports.length > 0 && !serialPath) {
                    setSerialPath(ports[0].path);
                }
            });
        }
    }, [protocol]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (protocol === 'serial') {
            onConnect({
                protocol: 'serial',
                path: serialPath,
                baudRate: parseInt(baudRate),
                dataBits: parseInt(dataBits),
                parity,
                stopBits: parseFloat(stopBits),
                flowControl,
            });
            return;
        }

        // Save to history (SSH/Telnet)
        if (host) {
            const newHistory = [host, ...history.filter(h => h !== host)].slice(0, 5);
            setHistory(newHistory);
            localStorage.setItem('hterm_host_history', JSON.stringify(newHistory));

            // Save username map if SSH
            if (protocol === 'ssh' && username) {
                const newMap = { ...usernameMap, [host]: username };
                setUsernameMap(newMap);
                localStorage.setItem('hterm_username_map', JSON.stringify(newMap));

                // Save password to memory cache
                if (password) {
                    saveCachedPassword(host, username, password);
                }
            }
        }

        onConnect({
            protocol,
            host,
            port: parseInt(port),
            username: protocol === 'ssh' ? username : undefined,
            password: protocol === 'ssh' ? password : undefined,
        });
    };

    const handleHostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newHost = e.target.value;
        setHost(newHost);

        // Auto-fill username if known host, otherwise clear it to avoid mismatch
        if (protocol === 'ssh') {
            const cachedUser = usernameMap[newHost] || '';
            setUsername(cachedUser);
            // Also update password based on new host/user combo
            setPassword(getCachedPassword(newHost, cachedUser));
        }
    };

    const handleHostKeyDown = (_e: React.KeyboardEvent<HTMLInputElement>) => {
        // Disabled aggressive clear
    };

    const handleUsernameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // If backspace pressed and current username matches the cached one for this host
        if (e.key === 'Backspace' && protocol === 'ssh' && usernameMap[host] === username && username.length > 0) {
            e.preventDefault();
            setUsername('');
            setPassword(''); // Clear password too
        }
    };

    // Update password when username changes
    const onUsernameChange = (newVal: string) => {
        setUsername(newVal);
        setPassword(getCachedPassword(host, newVal));
    }

    return (
        <div className="connection-dialog-overlay">
            <div className="connection-dialog" style={{ position: 'relative' }}>
                <button
                    onClick={onClose}
                    style={{
                        position: 'absolute',
                        top: '10px',
                        right: '10px',
                        background: 'transparent',
                        border: 'none',
                        color: '#ccc',
                        cursor: 'pointer',
                        fontSize: '1.2rem',
                        lineHeight: 1
                    }}
                >
                    ✕
                </button>
                <h2 style={{ marginTop: 0, paddingRight: '20px' }}>New Connection</h2>
                {error && (
                    <div className="error-message" style={{ color: '#ff6b6b', marginBottom: '10px', padding: '10px', backgroundColor: 'rgba(255,0,0,0.1)', borderRadius: '4px' }}>
                        {error}
                    </div>
                )}
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Protocol</label>
                        <select
                            value={protocol}
                            onChange={(e) => {
                                const newProtocol = e.target.value;
                                setProtocol(newProtocol);
                                if (newProtocol === 'ssh') {
                                    setPort('22');
                                    setUsername(usernameMap[host] || '');
                                } else if (newProtocol === 'telnet') {
                                    setPort('23');
                                    setUsername('');
                                }
                            }}
                        >
                            <option value="ssh">SSH</option>
                            <option value="telnet">Telnet</option>
                            <option value="serial">Serial</option>
                        </select>
                    </div>

                    {/* SSH/Telnet fields */}
                    {protocol !== 'serial' && (
                        <>
                            <div className="form-group">
                                <label>Host</label>
                                <input
                                    type="text"
                                    value={host}
                                    onChange={handleHostChange}
                                    onKeyDown={handleHostKeyDown}
                                    placeholder="example.com"
                                    list="host-history"
                                    required
                                    autoFocus
                                />
                                <datalist id="host-history">
                                    {history.map((h, i) => (
                                        <option key={i} value={h} />
                                    ))}
                                </datalist>
                            </div>
                            <div className="form-group">
                                <label>Port</label>
                                <input
                                    type="number"
                                    value={port}
                                    onChange={(e) => setPort(e.target.value)}
                                    required
                                />
                            </div>
                            {protocol === 'ssh' && (
                                <div className="form-group">
                                    <label>Username</label>
                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(e) => onUsernameChange(e.target.value)}
                                        onKeyDown={handleUsernameKeyDown}
                                        required
                                    />
                                </div>
                            )}
                            {protocol === 'ssh' && (
                                <div className="form-group">
                                    <label>Password</label>
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                    />
                                </div>
                            )}
                        </>
                    )}

                    {/* Serial fields */}
                    {protocol === 'serial' && (
                        <>
                            <div className="form-group">
                                <label>Serial Port</label>
                                {serialPorts.length > 0 ? (
                                    <select
                                        value={serialPath}
                                        onChange={(e) => setSerialPath(e.target.value)}
                                    >
                                        {serialPorts.map((p) => (
                                            <option key={p.path} value={p.path}>
                                                {p.path}{p.manufacturer ? ` (${p.manufacturer})` : ''}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        type="text"
                                        value={serialPath}
                                        onChange={(e) => setSerialPath(e.target.value)}
                                        placeholder="COM3"
                                        required
                                    />
                                )}
                            </div>
                            <div className="form-row">
                                <div className="form-group form-group-half">
                                    <label>Baud Rate</label>
                                    <select value={baudRate} onChange={(e) => setBaudRate(e.target.value)}>
                                        <option value="9600">9600</option>
                                        <option value="19200">19200</option>
                                        <option value="38400">38400</option>
                                        <option value="57600">57600</option>
                                        <option value="115200">115200</option>
                                    </select>
                                </div>
                                <div className="form-group form-group-half">
                                    <label>Data Bits</label>
                                    <select value={dataBits} onChange={(e) => setDataBits(e.target.value)}>
                                        <option value="8">8</option>
                                        <option value="7">7</option>
                                        <option value="6">6</option>
                                        <option value="5">5</option>
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group form-group-half">
                                    <label>Parity</label>
                                    <select value={parity} onChange={(e) => setParity(e.target.value)}>
                                        <option value="none">None</option>
                                        <option value="odd">Odd</option>
                                        <option value="even">Even</option>
                                        <option value="mark">Mark</option>
                                        <option value="space">Space</option>
                                    </select>
                                </div>
                                <div className="form-group form-group-half">
                                    <label>Stop Bits</label>
                                    <select value={stopBits} onChange={(e) => setStopBits(e.target.value)}>
                                        <option value="1">1</option>
                                        <option value="1.5">1.5</option>
                                        <option value="2">2</option>
                                    </select>
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Flow Control</label>
                                <select value={flowControl} onChange={(e) => setFlowControl(e.target.value)}>
                                    <option value="none">None</option>
                                    <option value="xon/xoff">XON/XOFF</option>
                                    <option value="rts/cts">RTS/CTS</option>
                                </select>
                            </div>
                        </>
                    )}

                    <div className="form-actions">
                        <button type="submit" className="btn-primary">Connect</button>
                    </div>
                </form>
            </div>
        </div>
    );
};
