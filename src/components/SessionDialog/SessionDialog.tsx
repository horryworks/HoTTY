import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useHostManager, decryptBatch, getCachedCredential, clearDecryptedCache, flattenHosts } from '../../hooks/useHostManager';
import type { HostTreeNode, HostEntry } from '../../hooks/useHostManager';
import { HostTree } from './HostTree';
import { useResize } from '../../hooks/useResize';
import { STORAGE_KEYS } from '../../constants/storage';
import * as electronService from '../../services/electronService';
import './SessionDialog.css';

interface ConnectionDialogProps {
    onConnect: (config: Record<string, unknown>) => void;
    onClose: () => void;
    error?: string | null;
    isConnecting?: boolean;
    connectionError?: string | null;
    getCachedPassword: (host: string, user: string) => string;
    saveCachedPassword: (host: string, user: string, pass: string) => void;
    onShowMessage?: (type: 'error' | 'success' | 'info', title: string | undefined, message: string) => void;
    loggingPath?: string;
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
    isConnecting = false,
    connectionError = null,
    getCachedPassword,
    saveCachedPassword,
    onShowMessage,
    loggingPath
}) => {
    const hostManager = useHostManager();

    const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
    const [isDecrypting, setIsDecrypting] = useState(false);
    const isSubmittingRef = useRef(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    useEffect(() => {
        if (!isConnecting) { isSubmittingRef.current = false; setIsSubmitting(false); }
    }, [isConnecting]);

    // Password reveal state
    const [passwordVisible, setPasswordVisible] = useState(false);
    const [showVerifyModal, setShowVerifyModal] = useState(false);
    const [verifyPassword, setVerifyPassword] = useState('');
    const [verifyError, setVerifyError] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const passwordRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const verifyInputRef = useRef<HTMLInputElement>(null);

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
        return () => {
            document.removeEventListener('keydown', handler);
            // Clear cache when dialog closes to free memory
            clearDecryptedCache();
        };
    }, [onClose]);


    // --- Panel divider resize ---
    const [treePanelWidth, setTreePanelWidth] = useState(600); // 2:1 tree:form default ratio
    const startTreePanelWidthRef = useRef(treePanelWidth);

    const { startResize: handlePanelDividerMouseDown } = useResize({
        orientation: 'horizontal',
        onMove: (dx) => {
            setTreePanelWidth(Math.max(150, Math.min(500, startTreePanelWidthRef.current + dx)));
        },
    });

    const handlePanelDividerMouseDownWrapped = useCallback((e: React.MouseEvent) => {
        startTreePanelWidthRef.current = treePanelWidth;
        handlePanelDividerMouseDown(e);
    }, [treePanelWidth, handlePanelDividerMouseDown]);

    // --- Dialog size and position (absolute top/left, so resize only expands right/bottom) ---
    const [dialogSize, setDialogSize] = useState({ width: 960, height: 540 });
    const [dialogPos, setDialogPos] = useState<{ top: number; left: number } | null>(null);

    // Keep dialog centered in viewport (on mount and whenever the window is resized)
    useEffect(() => {
        const center = () => {
            setDialogPos(prev => {
                const w = prev ? dialogSize.width : 960;
                const h = prev ? dialogSize.height : 540;
                return {
                    top: Math.max(0, (window.innerHeight - h) / 2),
                    left: Math.max(0, (window.innerWidth - w) / 2),
                };
            });
        };
        center();
        window.addEventListener('resize', center);
        return () => window.removeEventListener('resize', center);
    }, [dialogSize]);

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
    const [displayName, setDisplayName] = useState('');
    const [host, setHost] = useState('');
    const [port, setPort] = useState('22');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [protocol, setProtocol] = useState('ssh');
    const [isJumpbox, setIsJumpbox] = useState(false);
    const [jumpboxId, setJumpboxId] = useState('');

    // Available jumpbox hosts (SSH hosts marked as jumpbox)
    const jumpboxHosts = useMemo(() =>
        flattenHosts(hostManager.tree).filter(n => n.entry?.isJumpbox && n.entry.protocol === 'ssh'),
        [hostManager.tree]
    );

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

    // Git Bash detection state
    const [gitBashAvailable, setGitBashAvailable] = useState<boolean | null>(null);

    // State to track original values to determine if the form is dirty
    const [originalState, setOriginalState] = useState<{
        name: string;
        protocol: string;
        host: string;
        port: string;
        username: string;
        password: string;
        isJumpbox: boolean;
        jumpboxId: string;
    } | null>(null);

    // Host history (used for deduplication when saving)
    const [history] = useState<string[]>(() => {
        const saved = localStorage.getItem(STORAGE_KEYS.HOST_HISTORY);
        return saved ? JSON.parse(saved) : [];
    });

    // Fetch resources when protocol changes
    useEffect(() => {
        if (protocol === 'serial') {
            electronService.listSerialPorts().then((ports: SerialPortInfo[]) => {
                setSerialPorts(ports);
                if (ports.length > 0) {
                    setSerialPath(prev => prev || ports[0].path);
                }
            });
        } else if (protocol === 'wsl') {
            electronService.listWslDistributions().then((distros: string[]) => {
                setWslDistros(distros);
                if (distros.length > 0) {
                    setSelectedDistro(prev => prev || distros[0]);
                }
            });
        } else if (protocol === 'git-bash') {
            electronService.detectGitBash().then((result: { available: boolean; path?: string }) => {
                setGitBashAvailable(result.available);
            });
        }
    }, [protocol]);

    // Sync displayName when the selected host is renamed in the tree
    useEffect(() => {
        if (!selectedHostId) return;
        const find = (nodes: HostTreeNode[]): HostTreeNode | undefined => {
            for (const n of nodes) {
                if (n.id === selectedHostId) return n;
                if (n.children) {
                    const f = find(n.children);
                    if (f) return f;
                }
            }
            return undefined;
        };
        const node = find(hostManager.tree);
        if (node && node.type === 'host') {
            setDisplayName(node.name);
            setOriginalState(prev => prev ? { ...prev, name: node.name } : prev);
        }
    }, [hostManager.tree, selectedHostId]);

    // --- Password reveal ---
    const clearPasswordRevealTimer = useCallback(() => {
        if (passwordRevealTimerRef.current) {
            clearTimeout(passwordRevealTimerRef.current);
            passwordRevealTimerRef.current = null;
        }
    }, []);

    // Hide password when password value changes or host selection changes
    useEffect(() => {
        setPasswordVisible(false);
        clearPasswordRevealTimer();
    }, [selectedHostId, clearPasswordRevealTimer]);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => clearPasswordRevealTimer();
    }, [clearPasswordRevealTimer]);

    const handlePasswordRevealClick = useCallback(() => {
        if (passwordVisible) {
            setPasswordVisible(false);
            clearPasswordRevealTimer();
            return;
        }
        if (!password) return;
        setVerifyPassword('');
        setVerifyError('');
        setShowVerifyModal(true);
        setTimeout(() => verifyInputRef.current?.focus(), 50);
    }, [passwordVisible, password, clearPasswordRevealTimer]);

    const handleVerifySubmit = useCallback(async () => {
        if (!verifyPassword || isVerifying) return;
        setIsVerifying(true);
        setVerifyError('');
        try {
            const ok = await electronService.verifyUser(verifyPassword);
            if (ok) {
                setShowVerifyModal(false);
                setVerifyPassword('');
                setPasswordVisible(true);
                clearPasswordRevealTimer();
                passwordRevealTimerRef.current = setTimeout(() => {
                    setPasswordVisible(false);
                }, 10000);
            } else {
                setVerifyError('Authentication failed');
            }
        } catch {
            setVerifyError('Authentication failed');
        } finally {
            setIsVerifying(false);
        }
    }, [verifyPassword, isVerifying, clearPasswordRevealTimer]);

    const handleVerifyCancel = useCallback(() => {
        setShowVerifyModal(false);
        setVerifyPassword('');
        setVerifyError('');
    }, []);

    // --- Select a host from the tree ---
    const handleSelectHost = async (node: HostTreeNode) => {
        setSelectedHostId(node.id);
        if (node.type !== 'host' || !node.entry) {
            setOriginalState(null);
            setDisplayName('');
            return;
        }

        const e = node.entry;
        setProtocol(e.protocol);
        setHost(e.host ?? '');
        setPort(String(e.port ?? (e.protocol === 'ssh' ? 22 : 23)));

        let u = e.username ?? '';
        let p = e.password ?? '';

        const cached = getCachedCredential(node.id);

        // On-demand decryption if they are still encrypted
        const needsDecryption: (string | undefined)[] = [undefined, undefined];
        if (u.startsWith('[DPAPI]')) {
            if (cached?.username !== undefined) u = cached.username;
            else needsDecryption[0] = u;
        }

        if (p.startsWith('[DPAPI]')) {
            if (cached?.password !== undefined) p = cached.password;
            else needsDecryption[1] = p;
        }

        if (needsDecryption.some(val => val !== undefined)) {
            setIsDecrypting(true);
            const [decU, decP] = await decryptBatch(needsDecryption);
            if (decU !== undefined) u = decU;
            if (decP !== undefined) p = decP;
            setIsDecrypting(false);
        }

        setUsername(u);
        // Prefer in-memory cached password, fall back to stored password
        const cachedPass = getCachedPassword(e.host ?? '', u);
        const finalPass = cachedPass !== '' ? cachedPass : p;
        setPassword(finalPass);
        setIsJumpbox(!!e.isJumpbox);
        setJumpboxId(e.jumpboxId ?? '');

        setDisplayName(node.name);
        setOriginalState({
            name: node.name,
            protocol: e.protocol,
            host: e.host ?? '',
            port: String(e.port ?? (e.protocol === 'ssh' ? 22 : 23)),
            username: u,
            password: finalPass,
            isJumpbox: !!e.isJumpbox,
            jumpboxId: e.jumpboxId ?? ''
        });
    };

    // --- Double-click a host: connect immediately using the node's data ---
    const handleDoubleClickHost = useCallback(async (node: HostTreeNode) => {
        if (node.type !== 'host' || !node.entry) return;
        const e = node.entry;
        await handleSelectHost(node); // wait for decryption to finish and form to fill

        // Use the latest decrypted state correctly
        // We know handleSelectHost will set state asynchronously, but to be 100% sure we can just decrypt here too
        let u = e.username ?? '';
        let p = e.password ?? '';

        const cached = getCachedCredential(node.id);

        const needsDecryption: (string | undefined)[] = [undefined, undefined];
        if (u.startsWith('[DPAPI]')) {
            if (cached?.username !== undefined) u = cached.username;
            else needsDecryption[0] = u;
        }

        if (p.startsWith('[DPAPI]')) {
            if (cached?.password !== undefined) p = cached.password;
            else needsDecryption[1] = p;
        }

        if (needsDecryption.some(val => val !== undefined)) {
            const [decU, decP] = await decryptBatch(needsDecryption);
            if (decU !== undefined) u = decU;
            if (decP !== undefined) p = decP;
        }

        const cachedPass = getCachedPassword(e.host ?? '', u);
        const finalPass = cachedPass !== '' ? cachedPass : p;

        // Resolve jumpbox credentials if the host has a jumpbox configured
        let jumpboxConfig: { host: string; port: number; username: string; password: string } | undefined;
        if (e.jumpboxId) {
            const jbNode = flattenHosts(hostManager.tree).find(n => n.id === e.jumpboxId);
            if (jbNode?.entry) {
                let jbUser = jbNode.entry.username ?? '';
                let jbPass = jbNode.entry.password ?? '';

                const jbCached = getCachedCredential(e.jumpboxId);
                const jbNeedsDecrypt: (string | undefined)[] = [undefined, undefined];
                if (jbUser.startsWith('[DPAPI]')) {
                    if (jbCached?.username !== undefined) jbUser = jbCached.username;
                    else jbNeedsDecrypt[0] = jbUser;
                }
                if (jbPass.startsWith('[DPAPI]')) {
                    if (jbCached?.password !== undefined) jbPass = jbCached.password;
                    else jbNeedsDecrypt[1] = jbPass;
                }
                if (jbNeedsDecrypt.some(v => v !== undefined)) {
                    const [decU, decP] = await decryptBatch(jbNeedsDecrypt);
                    if (decU !== undefined) jbUser = decU;
                    if (decP !== undefined) jbPass = decP;
                }

                jumpboxConfig = {
                    host: jbNode.entry.host,
                    port: jbNode.entry.port,
                    username: jbUser,
                    password: jbPass,
                };
            }
        }

        onConnect({
            protocol: e.protocol,
            host: e.host,
            port: e.port,
            username: (e.protocol === 'ssh' || e.protocol === 'telnet') ? u : undefined,
            password: (e.protocol === 'ssh' || e.protocol === 'telnet') ? finalPass : undefined,
            jumpboxId: e.jumpboxId || undefined,
            jumpbox: jumpboxConfig,
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getCachedPassword, onConnect, hostManager.tree]);

    // Check if current form is dirty compared to original state
    const isDirty = originalState !== null && (
        originalState.name !== displayName ||
        originalState.protocol !== protocol ||
        originalState.host !== host ||
        originalState.port !== String(port) ||
        originalState.username !== username ||
        originalState.password !== password ||
        originalState.isJumpbox !== isJumpbox ||
        originalState.jumpboxId !== jumpboxId
    );

    const handleSave = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!selectedHostId || !isDirty) return;

        let finalU = username;
        let finalP = password;

        if (finalU.startsWith('[DPAPI]') || finalP.startsWith('[DPAPI]')) {
            const cached = getCachedCredential(selectedHostId);
            const needsDecryption = [undefined, undefined] as (string | undefined)[];
            if (finalU.startsWith('[DPAPI]')) {
                if (cached?.username !== undefined) finalU = cached.username;
                else needsDecryption[0] = finalU;
            }
            if (finalP.startsWith('[DPAPI]')) {
                if (cached?.password !== undefined) finalP = cached.password;
                else needsDecryption[1] = finalP;
            }

            if (needsDecryption.some(val => val !== undefined)) {
                setIsDecrypting(true);
                const [decU, decP] = await decryptBatch(needsDecryption);
                if (decU !== undefined) { finalU = decU; setUsername(decU); }
                if (decP !== undefined) { finalP = decP; setPassword(decP); }
                setIsDecrypting(false);
            }
        }

        // Update Original State
        setOriginalState({
            name: displayName,
            protocol,
            host,
            port: String(port),
            username: finalU,
            password: finalP,
            isJumpbox,
            jumpboxId
        });

        const entry: HostEntry = {
            protocol: protocol as 'ssh' | 'telnet',
            host,
            port: parseInt(port),
            username: (protocol === 'ssh' || protocol === 'telnet') ? finalU : undefined,
            password: (protocol === 'ssh' || protocol === 'telnet') ? finalP : undefined,
            isJumpbox: protocol === 'ssh' ? (isJumpbox || undefined) : undefined,
            jumpboxId: jumpboxId || undefined,
        };

        hostManager.editNode(selectedHostId, { name: displayName, entry });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmittingRef.current) return;
        isSubmittingRef.current = true;
        setIsSubmitting(true);

        // Ensure we don't connect with raw DPAPI values if they somehow bypassed handleSelectHost
        let finalU = username;
        let finalP = password;
        if (finalU.startsWith('[DPAPI]') || finalP.startsWith('[DPAPI]')) {
            const cached = selectedHostId ? getCachedCredential(selectedHostId) : undefined;

            const needsDecryption = [undefined, undefined] as (string | undefined)[];
            if (finalU.startsWith('[DPAPI]')) {
                if (cached?.username !== undefined) finalU = cached.username;
                else needsDecryption[0] = finalU;
            }
            if (finalP.startsWith('[DPAPI]')) {
                if (cached?.password !== undefined) finalP = cached.password;
                else needsDecryption[1] = finalP;
            }

            if (needsDecryption.some(val => val !== undefined)) {
                setIsDecrypting(true);
                const [decU, decP] = await decryptBatch(needsDecryption);
                if (decU !== undefined) { finalU = decU; setUsername(decU); }
                if (decP !== undefined) { finalP = decP; setPassword(decP); }
                setIsDecrypting(false);
            }
        }

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
        if (protocol === 'git-bash') {
            onConnect({ protocol: 'git-bash', shellType: 'git-bash' });
            return;
        }
        if (protocol === 'log-viewer') {
            onConnect({ protocol: 'log-viewer' });
            return;
        }

        // Save host history
        if (host) {
            const newHistory = [host, ...history.filter(h => h !== host)].slice(0, 5);
            localStorage.setItem(STORAGE_KEYS.HOST_HISTORY, JSON.stringify(newHistory));

            if (protocol === 'ssh' && username) {
                // Persist host→username map encrypted via DPAPI
                try {
                    const encryptedMap = localStorage.getItem(STORAGE_KEYS.USERNAME_MAP) || '';
                    let usernameMap: Record<string, string> = {};
                    if (encryptedMap) {
                        const decrypted = await electronService.decryptSecret(encryptedMap);
                        usernameMap = JSON.parse(decrypted);
                    }
                    usernameMap[host] = finalU;
                    const encrypted = await electronService.encryptSecret(JSON.stringify(usernameMap));
                    localStorage.setItem(STORAGE_KEYS.USERNAME_MAP, encrypted);
                } catch (err) {
                    console.error('Failed to persist username map:', err);
                }
                if (finalP) saveCachedPassword(host, finalU, finalP);
            }

            // Persist credential changes back to the selected tree node
            if (selectedHostId && (protocol === 'ssh' || protocol === 'telnet')) {
                const entry: HostEntry = {
                    protocol: protocol as 'ssh' | 'telnet',
                    host,
                    port: parseInt(port),
                    username: (protocol === 'ssh' || protocol === 'telnet') ? finalU : undefined,
                    password: (protocol === 'ssh' || protocol === 'telnet') ? finalP : undefined,
                    isJumpbox: protocol === 'ssh' ? (isJumpbox || undefined) : undefined,
                    jumpboxId: jumpboxId || undefined,
                };
                // Save directly via saveTree (awaited) to ensure localStorage is updated
                // before onConnect closes the dialog. editNode's save inside setTree updater
                // may be discarded by React if the component unmounts before the batch flushes.
                const patchTree = (nodes: HostTreeNode[], id: string): HostTreeNode[] =>
                    nodes.map(n => {
                        if (n.id === id) return { ...n, entry };
                        if (n.children) return { ...n, children: patchTree(n.children, id) };
                        return n;
                    });
                await hostManager.saveTree(patchTree(hostManager.tree, selectedHostId));
            }
        }

        // Resolve jumpbox credentials if a jumpbox is selected
        let jumpboxConfig: { host: string; port: number; username: string; password: string } | undefined;
        if (jumpboxId) {
            const jbNode = flattenHosts(hostManager.tree).find(n => n.id === jumpboxId);
            if (jbNode?.entry) {
                let jbUser = jbNode.entry.username ?? '';
                let jbPass = jbNode.entry.password ?? '';

                const jbCached = getCachedCredential(jumpboxId);
                const jbNeedsDecrypt: (string | undefined)[] = [undefined, undefined];
                if (jbUser.startsWith('[DPAPI]')) {
                    if (jbCached?.username !== undefined) jbUser = jbCached.username;
                    else jbNeedsDecrypt[0] = jbUser;
                }
                if (jbPass.startsWith('[DPAPI]')) {
                    if (jbCached?.password !== undefined) jbPass = jbCached.password;
                    else jbNeedsDecrypt[1] = jbPass;
                }
                if (jbNeedsDecrypt.some(v => v !== undefined)) {
                    const [decU, decP] = await decryptBatch(jbNeedsDecrypt);
                    if (decU !== undefined) jbUser = decU;
                    if (decP !== undefined) jbPass = decP;
                }

                jumpboxConfig = {
                    host: jbNode.entry.host,
                    port: jbNode.entry.port,
                    username: jbUser,
                    password: jbPass,
                };
            }
        }

        onConnect({
            protocol,
            host,
            port: parseInt(port),
            username: (protocol === 'ssh' || protocol === 'telnet') ? finalU : undefined,
            password: (protocol === 'ssh' || protocol === 'telnet') ? finalP : undefined,
            jumpboxId: jumpboxId || undefined,
            jumpbox: jumpboxConfig,
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
                    style={{ position: 'absolute', top: '10px', right: '10px', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'calc(var(--font-size-base) + 5px)', lineHeight: 1, zIndex: 1 }}
                >✕</button>

                <h2 style={{ marginTop: 0, paddingRight: '20px', marginBottom: '10px' }}>New Session</h2>

                {error && (
                    <div style={{ color: 'var(--color-danger)', marginBottom: '8px', padding: '8px 10px', backgroundColor: 'var(--color-danger-bg)', borderRadius: '4px', fontSize: 'calc(var(--font-size-base) - 1px)' }}>
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
                            onMoveNode={hostManager.moveNode}
                            onSortFolder={hostManager.sortFolder}
                            onImportData={hostManager.importData}
                            onShowMessage={onShowMessage}
                        />
                    </div>

                    {/* Draggable vertical divider */}
                    <div className="panel-divider" onMouseDown={handlePanelDividerMouseDownWrapped} />

                    {/* Right panel: Connection form */}
                    <div className="form-panel">
                        <form ref={formRef} onSubmit={handleSubmit}>
                          <fieldset disabled={isSubmitting || isConnecting} style={{ border: 'none', padding: 0, margin: 0 }}>
                            {/* Disabled unless a host is selected where display name makes sense, but show it if selectedHostId is present */}
                            {originalState !== null && (
                                <div className="form-group">
                                    <label>Name</label>
                                    <input
                                        type="text"
                                        value={displayName}
                                        onChange={e => setDisplayName(e.target.value)}
                                        placeholder="Display Name"
                                    />
                                </div>
                            )}

                            <div className="form-group">
                                <label>Protocol</label>
                                <select
                                    value={protocol}
                                    onChange={(e) => {
                                        const p = e.target.value;
                                        setProtocol(p);
                                        if (p === 'ssh') setPort('22');
                                        else if (p === 'telnet') setPort('23');
                                        if (p !== 'ssh') setIsJumpbox(false);
                                        if (p !== 'ssh' && p !== 'telnet') setJumpboxId('');
                                    }}
                                >
                                    <option value="ssh">SSH</option>
                                    <option value="telnet">Telnet</option>
                                    <option value="serial">Serial</option>
                                    <option value="wsl">WSL</option>
                                    <option value="cmd">Command Prompt</option>
                                    <option value="powershell">PowerShell</option>
                                    <option value="git-bash">Git Bash</option>

                                </select>
                            </div>

                            {(protocol === 'ssh' || protocol === 'telnet') && (
                                <div className="form-group form-group-checkbox">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={isJumpbox}
                                            onChange={e => setIsJumpbox(e.target.checked)}
                                            disabled={protocol !== 'ssh'}
                                        />
                                        Use as Jumpbox
                                    </label>
                                </div>
                            )}

                            {/* SSH/Telnet fields */}
                            {(protocol !== 'serial' && protocol !== 'wsl' && protocol !== 'cmd' && protocol !== 'powershell' && protocol !== 'git-bash' && protocol !== 'log-viewer') && (
                                <>
                                    <div className="form-row">
                                        <div className="form-group" style={{ flex: 3 }}>
                                            <label>Host/IP</label>
                                            <input
                                                type="text"
                                                value={host}
                                                onChange={e => setHost(e.target.value)}
                                                placeholder="example.com"
                                                required
                                                autoFocus
                                            />
                                        </div>
                                        <div className="form-group" style={{ flex: 1 }}>
                                            <label>Port</label>
                                            <input
                                                type="number"
                                                value={port}
                                                onChange={e => setPort(e.target.value)}
                                                required
                                            />
                                        </div>
                                    </div>
                                    {(protocol === 'ssh' || protocol === 'telnet') && (
                                        <div className="form-group">
                                            <label>Username</label>
                                            <input
                                                type="text"
                                                value={isDecrypting ? 'Decrypting...' : username}
                                                onChange={e => setUsername(e.target.value)}
                                                className={isDecrypting ? 'decrypting-placeholder' : ''}
                                                disabled={isDecrypting}
                                                autoComplete="off"
                                                required={protocol === 'ssh'}
                                            />
                                        </div>
                                    )}
                                    {(protocol === 'ssh' || protocol === 'telnet') && (
                                        <div className="form-group">
                                            <label>Password</label>
                                            <div className="password-input-wrapper">
                                                <input
                                                    type={passwordVisible ? 'text' : 'password'}
                                                    value={isDecrypting ? 'Decrypting...' : password}
                                                    onChange={e => setPassword(e.target.value)}
                                                    className={isDecrypting ? 'decrypting-placeholder' : ''}
                                                    disabled={isDecrypting}
                                                    autoComplete="new-password"
                                                />
                                                {password && !isDecrypting && (
                                                    <button
                                                        type="button"
                                                        className="password-reveal-btn"
                                                        onClick={handlePasswordRevealClick}
                                                        title={passwordVisible ? 'Hide password' : 'Show password'}
                                                        tabIndex={-1}
                                                    >
                                                        {passwordVisible ? (
                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                                                                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                                                                <line x1="1" y1="1" x2="23" y2="23" />
                                                            </svg>
                                                        ) : (
                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                                                <circle cx="12" cy="12" r="3" />
                                                            </svg>
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {(protocol === 'ssh' || protocol === 'telnet') && jumpboxHosts.length > 0 && (
                                        <div className="form-group">
                                            <label>Jumpbox</label>
                                            <select
                                                value={jumpboxId}
                                                onChange={e => setJumpboxId(e.target.value)}
                                            >
                                                <option value="">Direct Connection</option>
                                                {jumpboxHosts
                                                    .filter(jb => jb.id !== selectedHostId)
                                                    .map(jb => (
                                                        <option key={jb.id} value={jb.id}>
                                                            {jb.name}
                                                        </option>
                                                    ))
                                                }
                                            </select>
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
                                        <div style={{ color: 'var(--text-secondary)', fontSize: 'calc(var(--font-size-base) - 1px)', fontStyle: 'italic' }}>
                                            No WSL distributions found.
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Git Bash status */}
                            {protocol === 'git-bash' && gitBashAvailable === false && (
                                <div className="form-group">
                                    <div style={{ color: 'var(--color-warning)', fontSize: 'calc(var(--font-size-base) - 1px)', fontStyle: 'italic' }}>
                                        Git Bash is not installed.
                                    </div>
                                </div>
                            )}

                            {/* Log Viewer info */}
                            {protocol === 'log-viewer' && (
                                <div className="form-group">
                                    <div style={{ color: 'var(--text-secondary)', fontSize: 'calc(var(--font-size-base) - 1px)', lineHeight: '1.5' }}>
                                        Opens a viewer for session log files.
                                    </div>
                                    <div style={{ marginTop: '8px', color: 'var(--text-secondary)', fontSize: 'calc(var(--font-size-base) - 2px)' }}>
                                        <strong>Log Folder:</strong>{' '}
                                        {loggingPath
                                            ? <span style={{ fontFamily: 'var(--font-family)', wordBreak: 'break-all' }}>{loggingPath}</span>
                                            : <span style={{ color: 'var(--color-warning)', fontStyle: 'italic' }}>Not configured (set in Settings → Logging)</span>
                                        }
                                    </div>
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

                          </fieldset>
                            <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center' }}>
                                {connectionError && (
                                    <span className="connection-error">{connectionError}</span>
                                )}
                                {isConnecting && !connectionError && (
                                    <span className="connection-status">Connecting...</span>
                                )}
                                {originalState !== null && protocol !== 'serial' && protocol !== 'wsl' && protocol !== 'cmd' && protocol !== 'powershell' && protocol !== 'git-bash' && protocol !== 'log-viewer' && (
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        onClick={handleSave}
                                        disabled={!isDirty || isDecrypting || isSubmitting || isConnecting}
                                        title={isDirty ? "Save changes to this host" : "No changes to save"}
                                    >
                                        Save
                                    </button>
                                )}
                                <button type="submit" className="btn-primary" disabled={isDecrypting || isSubmitting || isConnecting || (protocol === 'git-bash' && gitBashAvailable === false)}>
                                    Connect
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
                {/* Bottom-right dialog resize handle */}
                <div className="dialog-resize-handle" onMouseDown={handleDialogResizeMouseDown} />
            </div>

            {/* Windows authentication modal for password reveal */}
            {showVerifyModal && (
                <div className="password-verify-overlay" onMouseDown={handleVerifyCancel}>
                    <div className="password-verify-modal" onMouseDown={e => e.stopPropagation()}>
                        <div className="password-verify-header">Windows Authentication</div>
                        <div className="password-verify-body">
                            <p>Enter your Windows password to reveal the saved credential.</p>
                            <input
                                ref={verifyInputRef}
                                type="password"
                                value={verifyPassword}
                                onChange={e => { setVerifyPassword(e.target.value); setVerifyError(''); }}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') { e.preventDefault(); handleVerifySubmit(); }
                                    if (e.key === 'Escape') { e.preventDefault(); handleVerifyCancel(); }
                                }}
                                placeholder="Windows password"
                                autoComplete="off"
                                disabled={isVerifying}
                            />
                            {verifyError && <div className="password-verify-error">{verifyError}</div>}
                        </div>
                        <div className="password-verify-actions">
                            <button type="button" className="btn-secondary" onClick={handleVerifyCancel} disabled={isVerifying}>Cancel</button>
                            <button type="button" className="btn-primary" onClick={handleVerifySubmit} disabled={!verifyPassword || isVerifying}>
                                {isVerifying ? 'Verifying...' : 'OK'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
