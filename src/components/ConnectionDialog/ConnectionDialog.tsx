import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useHostManager } from '../../hooks/useHostManager';
import type { HostTreeNode, HostEntry } from '../../hooks/useHostManager';
import { HostTree } from './HostTree';
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
    const hostManager = useHostManager();

    const [selectedHostId, setSelectedHostId] = useState<string | null>(null);

    // Ref to the connection form for programmatic submission
    const formRef = useRef<HTMLFormElement>(null);
    // Ref to the outer dialog container for scoped key handling
    const containerRef = useRef<HTMLDivElement>(null);

    // Ref to track selectedHostId inside the event listener (avoids stale closure)
    const selectedHostIdRef = useRef<string | null>(null);
    selectedHostIdRef.current = selectedHostId;

    // Submit the form when Enter is pressed:
    //  - while focus is inside the right-side form panel, OR
    //  - while a focusable host row (tabIndex=0) in the left panel has focus and a host is selected.
    // Does NOT fire when the HostTree edit modal is open (it handles Enter/Escape itself).
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Ignore if the HostTree edit modal is currently open (it handles its own keys)
            if (document.querySelector('.host-edit-modal-overlay')) return;

            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
            }

            if (e.key !== 'Enter') return;
            const active = document.activeElement;
            const container = containerRef.current;
            if (!container) return;
            const inFormPanel = container.querySelector('.form-panel')?.contains(active);
            const inHostPanel = container.querySelector('.host-panel')?.contains(active);
            if (inFormPanel || (inHostPanel && selectedHostIdRef.current)) {
                e.preventDefault();
                formRef.current?.requestSubmit();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);


    // --- Panel divider resize ---
    const [treePanelWidth, setTreePanelWidth] = useState(600); // 2:1 tree:form default ratio
    const panelResizeState = useRef<{ startX: number; startWidth: number } | null>(null);

    const handlePanelDividerMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = treePanelWidth;
        panelResizeState.current = { startX, startWidth };
        const onMove = (ev: MouseEvent) => {
            const delta = ev.clientX - startX;
            setTreePanelWidth(Math.max(150, Math.min(500, startWidth + delta)));
        };
        const onUp = () => {
            panelResizeState.current = null;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.style.cursor = 'col-resize';
    }, [treePanelWidth]);

    // --- Dialog size and position (absolute top/left, so resize only expands right/bottom) ---
    const [dialogSize, setDialogSize] = useState({ width: 960, height: 540 });
    const [dialogPos, setDialogPos] = useState<{ top: number; left: number } | null>(null);

    // Initialize dialog position to viewport center when first rendered
    const dialogPosInitialized = useRef(false);
    useEffect(() => {
        if (!dialogPosInitialized.current) {
            const w = 960;
            const h = 540;
            setDialogPos({
                top: Math.max(0, (window.innerHeight - h) / 2),
                left: Math.max(0, (window.innerWidth - w) / 2),
            });
            dialogPosInitialized.current = true;
        }
    }, []);

    // Drag the dialog by its header (replaces useDraggable transform)
    const dragState = useRef<{ startX: number; startY: number; startTop: number; startLeft: number } | null>(null);
    const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.dialog-resize-handle')) return;
        e.preventDefault();
        const pos = dialogPos ?? { top: (window.innerHeight - dialogSize.height) / 2, left: (window.innerWidth - dialogSize.width) / 2 };
        dragState.current = { startX: e.clientX, startY: e.clientY, startTop: pos.top, startLeft: pos.left };
        const onMove = (ev: MouseEvent) => {
            if (!dragState.current) return;
            setDialogPos({
                top: Math.max(0, dragState.current.startTop + ev.clientY - dragState.current.startY),
                left: Math.max(0, dragState.current.startLeft + ev.clientX - dragState.current.startX),
            });
        };
        const onUp = () => {
            dragState.current = null;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.style.cursor = 'grab';
    }, [dialogPos, dialogSize]);

    const dialogResizeState = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
    const handleDialogResizeMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const { startX, startY, startW, startH } = { startX: e.clientX, startY: e.clientY, startW: dialogSize.width, startH: dialogSize.height };
        dialogResizeState.current = { startX, startY, startW, startH };
        const onMove = (ev: MouseEvent) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            setDialogSize({ width: Math.max(640, startW + dx), height: Math.max(420, startH + dy) });
        };
        const onUp = () => {
            dialogResizeState.current = null;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.body.style.cursor = 'nwse-resize';
    }, [dialogSize]);

    // --- Connection form state ---
    const [host, setHost] = useState('');
    const [port, setPort] = useState('22');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [protocol, setProtocol] = useState('ssh');

    // Serial-specific state
    const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
    const [serialPath, setSerialPath] = useState('');
    const [baudRate, setBaudRate] = useState('9600');
    const [dataBits, setDataBits] = useState('8');
    const [parity, setParity] = useState('none');
    const [stopBits, setStopBits] = useState('1');
    const [flowControl, setFlowControl] = useState('none');

    // WSL-specific state
    const [wslDistros, setWslDistros] = useState<string[]>([]);
    const [selectedDistro, setSelectedDistro] = useState('');

    // Host history (legacy, kept for datalist)
    const [history] = useState<string[]>(() => {
        const saved = localStorage.getItem('hterm_host_history');
        return saved ? JSON.parse(saved) : [];
    });

    // Fetch resources when protocol changes
    useEffect(() => {
        if (protocol === 'serial') {
            (window as any).electronAPI.listSerialPorts().then((ports: SerialPortInfo[]) => {
                setSerialPorts(ports);
                if (ports.length > 0) {
                    setSerialPath(prev => prev || ports[0].path);
                }
            });
        } else if (protocol === 'wsl') {
            (window as any).electronAPI.listWslDistributions().then((distros: string[]) => {
                setWslDistros(distros);
                if (distros.length > 0) {
                    setSelectedDistro(prev => prev || distros[0]);
                }
            });
        }
    }, [protocol]);

    // --- Select a host from the tree ---
    const handleSelectHost = (node: HostTreeNode) => {
        if (node.type !== 'host' || !node.entry) return;
        setSelectedHostId(node.id);
        const e = node.entry;
        setProtocol(e.protocol);
        setHost(e.host ?? '');
        setPort(String(e.port ?? (e.protocol === 'ssh' ? 22 : 23)));
        setUsername(e.username ?? '');
        // Prefer in-memory cached password, fall back to stored password
        const cachedPass = getCachedPassword(e.host ?? '', e.username ?? '');
        setPassword(cachedPass !== '' ? cachedPass : (e.password ?? ''));
    };

    // --- Double-click a host: connect immediately using the node's data ---
    const handleDoubleClickHost = useCallback((node: HostTreeNode) => {
        if (node.type !== 'host' || !node.entry) return;
        const e = node.entry;
        handleSelectHost(node); // also fill the form for visual feedback
        const cachedPass = getCachedPassword(e.host ?? '', e.username ?? '');
        const pass = cachedPass !== '' ? cachedPass : (e.password ?? '');
        onConnect({
            protocol: e.protocol,
            host: e.host,
            port: e.port,
            username: e.protocol === 'ssh' ? (e.username ?? '') : undefined,
            password: e.protocol === 'ssh' ? pass : undefined,
        });
    }, [getCachedPassword, onConnect]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (protocol === 'serial') {
            onConnect({ protocol: 'serial', path: serialPath, baudRate: parseInt(baudRate), dataBits: parseInt(dataBits), parity, stopBits: parseFloat(stopBits), flowControl });
            return;
        }
        if (protocol === 'wsl') {
            onConnect({ protocol: 'wsl', distro: selectedDistro });
            return;
        }
        if (protocol === 'cmd' || protocol === 'powershell') {
            onConnect({ protocol, shellType: protocol });
            return;
        }

        // Save host history
        if (host) {
            const newHistory = [host, ...history.filter(h => h !== host)].slice(0, 5);
            localStorage.setItem('hterm_host_history', JSON.stringify(newHistory));

            if (protocol === 'ssh' && username) {
                // Persist host→username map encrypted via DPAPI
                try {
                    const encryptedMap = localStorage.getItem('hterm_username_map') || '';
                    let usernameMap: Record<string, string> = {};
                    if (encryptedMap) {
                        const decrypted = await window.electronAPI.decryptSecret(encryptedMap);
                        usernameMap = JSON.parse(decrypted);
                    }
                    usernameMap[host] = username;
                    const encrypted = await window.electronAPI.encryptSecret(JSON.stringify(usernameMap));
                    localStorage.setItem('hterm_username_map', encrypted);
                } catch (err) {
                    console.error('Failed to persist username map:', err);
                }
                if (password) saveCachedPassword(host, username, password);
            }

            // Persist credential changes back to the selected tree node
            if (selectedHostId && (protocol === 'ssh' || protocol === 'telnet')) {
                const entry: HostEntry = {
                    protocol: protocol as 'ssh' | 'telnet',
                    host,
                    port: parseInt(port),
                    username: protocol === 'ssh' ? username : undefined,
                    password: protocol === 'ssh' ? password : undefined,
                };
                hostManager.editNode(selectedHostId, { entry });
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

    return (
        <div className="connection-dialog-overlay">
            <div
                className="connection-dialog connection-dialog-wide"
                ref={containerRef}
                style={{
                    position: 'absolute',
                    top: dialogPos?.top ?? '50%',
                    left: dialogPos?.left ?? '50%',
                    transform: dialogPos ? 'none' : 'translate(-50%, -50%)',
                    width: dialogSize.width,
                    height: dialogSize.height,
                }}
            >
                {/* Drag handle — full header area */}
                <div
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '40px', cursor: 'grab', zIndex: 0 }}
                    onMouseDown={handleHeaderMouseDown}
                />
                <button
                    onClick={onClose}
                    style={{ position: 'absolute', top: '10px', right: '10px', background: 'transparent', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1, zIndex: 1 }}
                >✕</button>

                <h2 style={{ marginTop: 0, paddingRight: '20px', marginBottom: '10px' }}>New Connection</h2>

                {error && (
                    <div style={{ color: '#ff6b6b', marginBottom: '8px', padding: '8px 10px', backgroundColor: 'rgba(255,0,0,0.1)', borderRadius: '4px', fontSize: '0.9rem' }}>
                        {error}
                    </div>
                )}

                {/* Two-panel body */}
                <div className="dialog-body">
                    {/* Left panel: Host tree */}
                    <div className="host-panel" style={{ width: treePanelWidth, flexShrink: 0 }}>
                        <HostTree
                            tree={hostManager.tree}
                            selectedId={selectedHostId}
                            onSelect={handleSelectHost}
                            onDoubleClickHost={handleDoubleClickHost}
                            onAddFolder={hostManager.addFolder}
                            onAddHost={hostManager.addHost}
                            onEditNode={hostManager.editNode}
                            onDeleteNode={hostManager.deleteNode}
                        />
                    </div>

                    {/* Draggable vertical divider */}
                    <div className="panel-divider" onMouseDown={handlePanelDividerMouseDown} />

                    {/* Right panel: Connection form */}
                    <div className="form-panel">
                        <form ref={formRef} onSubmit={handleSubmit}>
                            <div className="form-group">
                                <label>Protocol</label>
                                <select
                                    value={protocol}
                                    onChange={(e) => {
                                        const p = e.target.value;
                                        setProtocol(p);
                                        if (p === 'ssh') setPort('22');
                                        else if (p === 'telnet') { setPort('23'); setUsername(''); }
                                    }}
                                >
                                    <option value="ssh">SSH</option>
                                    <option value="telnet">Telnet</option>
                                    <option value="serial">Serial</option>
                                    <option value="wsl">WSL</option>
                                    <option value="cmd">Command Prompt</option>
                                    <option value="powershell">PowerShell</option>
                                </select>
                            </div>

                            {/* SSH/Telnet fields */}
                            {(protocol !== 'serial' && protocol !== 'wsl' && protocol !== 'cmd' && protocol !== 'powershell') && (
                                <>
                                    <div className="form-group">
                                        <label>Host</label>
                                        <input
                                            type="text"
                                            value={host}
                                            onChange={e => setHost(e.target.value)}
                                            placeholder="example.com"
                                            list="host-history"
                                            required
                                            autoFocus
                                        />
                                        <datalist id="host-history">
                                            {history.map((h, i) => <option key={i} value={h} />)}
                                        </datalist>
                                    </div>
                                    <div className="form-group">
                                        <label>Port</label>
                                        <input
                                            type="number"
                                            value={port}
                                            onChange={e => setPort(e.target.value)}
                                            required
                                        />
                                    </div>
                                    {protocol === 'ssh' && (
                                        <div className="form-group">
                                            <label>Username</label>
                                            <input
                                                type="text"
                                                value={username}
                                                onChange={e => setUsername(e.target.value)}
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
                                                onChange={e => setPassword(e.target.value)}
                                            />
                                        </div>
                                    )}
                                </>
                            )}

                            {/* WSL fields */}
                            {protocol === 'wsl' && (
                                <div className="form-group">
                                    <label>Distribution</label>
                                    {wslDistros.length > 0 ? (
                                        <select value={selectedDistro} onChange={e => setSelectedDistro(e.target.value)}>
                                            {wslDistros.map(d => <option key={d} value={d}>{d}</option>)}
                                        </select>
                                    ) : (
                                        <div style={{ color: '#aaa', fontSize: '0.9rem', fontStyle: 'italic' }}>
                                            No WSL distributions found.
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Serial fields */}
                            {protocol === 'serial' && (
                                <>
                                    <div className="form-group">
                                        <label>Serial Port</label>
                                        {serialPorts.length > 0 ? (
                                            <select value={serialPath} onChange={e => setSerialPath(e.target.value)}>
                                                {serialPorts.map(p => (
                                                    <option key={p.path} value={p.path}>
                                                        {p.path}{p.manufacturer ? ` (${p.manufacturer})` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input type="text" value={serialPath} onChange={e => setSerialPath(e.target.value)} placeholder="COM3" required />
                                        )}
                                    </div>
                                    <div className="form-row">
                                        <div className="form-group form-group-half">
                                            <label>Baud Rate</label>
                                            <select value={baudRate} onChange={e => setBaudRate(e.target.value)}>
                                                <option value="9600">9600</option>
                                                <option value="19200">19200</option>
                                                <option value="38400">38400</option>
                                                <option value="57600">57600</option>
                                                <option value="115200">115200</option>
                                            </select>
                                        </div>
                                        <div className="form-group form-group-half">
                                            <label>Data Bits</label>
                                            <select value={dataBits} onChange={e => setDataBits(e.target.value)}>
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
                                            <select value={parity} onChange={e => setParity(e.target.value)}>
                                                <option value="none">None</option>
                                                <option value="odd">Odd</option>
                                                <option value="even">Even</option>
                                                <option value="mark">Mark</option>
                                                <option value="space">Space</option>
                                            </select>
                                        </div>
                                        <div className="form-group form-group-half">
                                            <label>Stop Bits</label>
                                            <select value={stopBits} onChange={e => setStopBits(e.target.value)}>
                                                <option value="1">1</option>
                                                <option value="1.5">1.5</option>
                                                <option value="2">2</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label>Flow Control</label>
                                        <select value={flowControl} onChange={e => setFlowControl(e.target.value)}>
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
                {/* Bottom-right dialog resize handle */}
                <div className="dialog-resize-handle" onMouseDown={handleDialogResizeMouseDown} />
            </div>
        </div>
    );
};
