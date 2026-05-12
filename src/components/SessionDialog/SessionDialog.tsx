import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useHostManager, decryptBatch, getCachedCredential, clearDecryptedCache, flattenHosts } from '../../hooks/useHostManager';
import { isEncrypted } from '../../services/tauriService';
import { tauriService } from '../../services/tauriService';
import { HostTree } from '../HostTree/HostTree';
import { useResize } from '../../hooks/useResize';
import { useSettingsStore } from '../../stores/settingsStore';
import type { HostTreeNode, HostEntry, ProtocolId, Encoding } from '../../types/appTypes';
import type {
    SshConnectionConfig,
    TelnetConnectionConfig,
    SerialConnectionConfig,
    WslConnectionConfig,
    LocalConnectionConfig,
    GcloudIapConnectionConfig,
    SerialPortInfo,
    GcloudStatus,
    GcloudAuthStatus,
    GcpProject,
    GceInstance,
} from '../../types/appTypes';
import './SessionDialog.css';

type AnyConfig =
    | SshConnectionConfig
    | TelnetConnectionConfig
    | SerialConnectionConfig
    | WslConnectionConfig
    | LocalConnectionConfig
    | GcloudIapConnectionConfig;

export interface ConnectSubmitPayload {
    displayName: string;
    protocol: ProtocolId;
    config: AnyConfig;
}

interface SessionDialogProps {
    open: boolean;
    onClose: () => void;
    onConnect: (payload: ConnectSubmitPayload) => void;
}

const PROTOCOLS: { value: ProtocolId; label: string }[] = [
    { value: 'ssh', label: 'SSH' },
    { value: 'telnet', label: 'Telnet' },
    { value: 'gcloud-iap', label: 'Google Cloud IAP' },
    { value: 'serial', label: 'Serial' },
    { value: 'wsl', label: 'WSL' },
    { value: 'cmd', label: 'Command Prompt' },
    { value: 'powershell', label: 'PowerShell' },
    { value: 'git-bash', label: 'Git Bash' },
];

const NETWORK_PROTOCOLS = new Set<ProtocolId>(['ssh', 'telnet']);

export const SessionDialog: React.FC<SessionDialogProps> = ({
    open: isOpen,
    onClose,
    onConnect,
}) => {
    const hostManager = useHostManager();
    const settings = useSettingsStore();

    const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
    const [isDecrypting, setIsDecrypting] = useState(false);

    // Ref to the connection form for programmatic submission
    const formRef = useRef<HTMLFormElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const selectedHostIdRef = useRef<string | null>(null);
    useEffect(() => {
        selectedHostIdRef.current = selectedHostId;
    }, [selectedHostId]);

    // --- Panel divider resize ---
    const [treePanelWidth, setTreePanelWidth] = useState(380);
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

    // --- Dialog size and position ---
    const [dialogSize, setDialogSize] = useState({ width: 960, height: 540 });
    const [dialogPos, setDialogPos] = useState<{ top: number; left: number } | null>(null);

    useEffect(() => {
        if (!isOpen) return;
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
    }, [dialogSize, isOpen]);

    // Dialog drag
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

    // Dialog resize
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
    const [protocol, setProtocol] = useState<ProtocolId>('ssh');
    const [isJumpbox, setIsJumpbox] = useState(false);
    const [jumpboxId, setJumpboxId] = useState('');

    // IAP tunnel state — visibility/enablement is driven by `protocol === 'gcloud-iap'`,
    // so there is no separate `iapEnabled` flag.
    const [iapProject, setIapProject] = useState('');
    const [iapZone, setIapZone] = useState('');
    const [iapInstance, setIapInstance] = useState('');
    const [iapGcloudStatus, setIapGcloudStatus] = useState<GcloudStatus | null>(null);
    const [iapAuthStatus, setIapAuthStatus] = useState<GcloudAuthStatus | null>(null);
    const [iapCheckingGcloud, setIapCheckingGcloud] = useState(false);
    const [iapCheckingAuth, setIapCheckingAuth] = useState(false);
    const [iapProjects, setIapProjects] = useState<GcpProject[]>([]);
    const [iapZones, setIapZones] = useState<string[]>([]);
    const [iapInstances, setIapInstances] = useState<GceInstance[]>([]);
    const [iapLoadingProjects, setIapLoadingProjects] = useState(false);
    const [iapLoadingZones, setIapLoadingZones] = useState(false);
    const [iapLoadingInstances, setIapLoadingInstances] = useState(false);
    const iapLoadingFromHostRef = useRef(false);

    // SSH-specific
    const [privateKeyPath, setPrivateKeyPath] = useState('');
    const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState('');

    // Serial
    const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
    const [serialPath, setSerialPath] = useState('');
    const [baudRate, setBaudRate] = useState('9600');
    const [dataBits, setDataBits] = useState('8');
    const [parity, setParity] = useState('none');
    const [stopBits, setStopBits] = useState('1');
    const [flowControl, setFlowControl] = useState('none');

    // WSL
    const [wslDistros, setWslDistros] = useState<string[]>([]);
    const [selectedDistro, setSelectedDistro] = useState('');

    // Git Bash
    const [gitBashPath, setGitBashPath] = useState<string | null>(null);

    // Common
    const [encoding, setEncoding] = useState<Encoding>(settings.globalEncoding);

    // Track original state for dirty detection
    const [originalState, setOriginalState] = useState<{
        name: string;
        protocol: string;
        host: string;
        port: string;
        username: string;
        password: string;
        isJumpbox: boolean;
        jumpboxId: string;
        iapProject: string;
        iapZone: string;
        iapInstance: string;
    } | null>(null);

    // Available jumpbox hosts
    const jumpboxHosts = useMemo(() =>
        flattenHosts(hostManager.tree).filter(n => n.entry?.isJumpbox && n.entry.protocol === 'ssh'),
        [hostManager.tree]
    );

    // --- Keyboard handling ---
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
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
            clearDecryptedCache();
        };
    }, [isOpen, onClose]);

    // --- Async data loading per protocol ---
    useEffect(() => {
        if (!isOpen) return;
        let aborted = false;

        if (protocol === 'serial') {
            tauriService.listSerialPorts().then((ports) => {
                if (aborted) return;
                setSerialPorts(ports);
                if (ports.length > 0 && !serialPath) {
                    setSerialPath(ports[0].path);
                }
            }).catch(() => { /* non-fatal */ });
        } else if (protocol === 'wsl') {
            tauriService.listWslDistributions().then((distros) => {
                if (aborted) return;
                setWslDistros(distros);
                if (distros.length > 0 && !selectedDistro) {
                    setSelectedDistro(distros[0]);
                }
            }).catch(() => { /* non-fatal */ });
        } else if (protocol === 'git-bash') {
            tauriService.detectGitBash().then((path) => {
                if (aborted) return;
                setGitBashPath(path ?? '');
            }).catch(() => {
                if (!aborted) setGitBashPath('');
            });
        }

        return () => { aborted = true; };
    }, [protocol, isOpen, selectedDistro, serialPath]);

    // --- IAP effects ---
    const isIap = protocol === 'gcloud-iap';
    useEffect(() => {
        if (!isIap) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setIapGcloudStatus(null);
            setIapAuthStatus(null);
            setIapProjects([]);
            setIapZones([]);
            setIapInstances([]);
            return;
        }
        let cancelled = false;
        setIapCheckingGcloud(true);
        setIapCheckingAuth(false);
        (async () => {
            const gcloud = await tauriService.gceIapCheckGcloud();
            if (cancelled) return;
            setIapGcloudStatus(gcloud);
            setIapCheckingGcloud(false);
            if (gcloud.available) {
                setIapCheckingAuth(true);
                const auth = await tauriService.gceIapCheckAuth();
                if (cancelled) return;
                setIapAuthStatus(auth);
                setIapCheckingAuth(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isIap]);

    const handleLoadProjects = useCallback(async () => {
        if (iapLoadingProjects || iapProjects.length > 0) return;
        setIapLoadingProjects(true);
        const projects = await tauriService.gceIapListProjects();
        setIapProjects(projects);
        setIapLoadingProjects(false);
    }, [iapLoadingProjects, iapProjects.length]);

    const handleLoadZones = useCallback(async () => {
        if (!iapProject || iapLoadingZones) return;
        setIapLoadingZones(true);
        const zones = await tauriService.gceIapListZones(iapProject);
        setIapZones(zones);
        setIapLoadingZones(false);
    }, [iapProject, iapLoadingZones]);

    const handleLoadInstances = useCallback(async () => {
        if (!iapProject || !iapZone || iapLoadingInstances) return;
        setIapLoadingInstances(true);
        const instances = await tauriService.gceIapListInstances(iapProject, iapZone);
        setIapInstances(instances);
        setIapLoadingInstances(false);
    }, [iapProject, iapZone, iapLoadingInstances]);

    useEffect(() => {
        if (iapAuthStatus?.authenticated && iapProjects.length === 0 && !iapLoadingProjects) {
            handleLoadProjects(); // eslint-disable-line react-hooks/set-state-in-effect
        }
    }, [iapAuthStatus?.authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (iapLoadingFromHostRef.current) return;
        setIapZones([]); // eslint-disable-line react-hooks/set-state-in-effect
        setIapInstances([]);
        if (iapProject) {
            handleLoadZones();
        }
    }, [iapProject]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (iapLoadingFromHostRef.current) return;
        setIapInstances([]); // eslint-disable-line react-hooks/set-state-in-effect
        if (iapZone) {
            handleLoadInstances();
        }
    }, [iapZone]); // eslint-disable-line react-hooks/exhaustive-deps

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
            setDisplayName(node.name); // eslint-disable-line react-hooks/set-state-in-effect
            setOriginalState(prev => prev ? { ...prev, name: node.name } : prev);
        }
    }, [hostManager.tree, selectedHostId]);

    // --- Reset form ---
    const resetForm = useCallback(() => {
        setSelectedHostId(null);
        setOriginalState(null);
        setDisplayName('');
        setHost('');
        setPort('22');
        setUsername('');
        setPassword('');
        setIsJumpbox(false);
        setJumpboxId('');
        setIapProject('');
        setIapZone('');
        setIapInstance('');
    }, []);

    // --- Select a host from the tree ---
    const handleSelectHost = async (node: HostTreeNode) => {
        setSelectedHostId(node.id);
        if (node.type !== 'host' || !node.entry) {
            setOriginalState(null);
            setDisplayName('');
            setHost('');
            setPort('22');
            setUsername('');
            setPassword('');
            setIsJumpbox(false);
            setJumpboxId('');
            setIapProject('');
            setIapZone('');
            setIapInstance('');
            return;
        }

        const e = node.entry;
        setProtocol(e.protocol);
        setHost(e.host ?? '');
        setPort(String(e.port ?? (e.protocol === 'ssh' ? 22 : 23)));

        let u = e.username ?? '';
        let p = e.password ?? '';

        const cached = getCachedCredential(node.id);

        const needsDecryption: (string | undefined)[] = [undefined, undefined];
        if (isEncrypted(u)) {
            if (cached?.username !== undefined) u = cached.username;
            else needsDecryption[0] = u;
        }
        if (isEncrypted(p)) {
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
        setPassword(p);
        setIsJumpbox(!!e.isJumpbox);
        setJumpboxId(e.jumpboxId ?? '');

        // IAP tunnel state — protocol === 'gcloud-iap' is the source of truth.
        iapLoadingFromHostRef.current = true;
        if (e.protocol === 'gcloud-iap' && e.iapTunnel) {
            setIapProject(e.iapTunnel.project);
            setIapZone(e.iapTunnel.zone);
            setIapInstance(e.iapTunnel.instance);
        } else {
            setIapProject('');
            setIapZone('');
            setIapInstance('');
        }
        requestAnimationFrame(() => { iapLoadingFromHostRef.current = false; });

        setDisplayName(node.name);
        setOriginalState({
            name: node.name,
            protocol: e.protocol,
            host: e.host ?? '',
            port: String(e.port ?? (e.protocol === 'ssh' ? 22 : 23)),
            username: u,
            password: p,
            isJumpbox: !!e.isJumpbox,
            jumpboxId: e.jumpboxId ?? '',
            iapProject: e.iapTunnel?.project ?? '',
            iapZone: e.iapTunnel?.zone ?? '',
            iapInstance: e.iapTunnel?.instance ?? '',
        });
    };

    // --- Double-click: connect immediately ---
    const handleDoubleClickHost = useCallback(async (node: HostTreeNode) => {
        if (node.type !== 'host' || !node.entry) return;
        const e = node.entry;
        const globalEncoding = useSettingsStore.getState().globalEncoding;

        // Fast path: IAP hosts have no credentials to decrypt — gcloud handles
        // authentication entirely.
        if (e.protocol === 'gcloud-iap' && e.iapTunnel) {
            const config: GcloudIapConnectionConfig = {
                project: e.iapTunnel.project,
                zone: e.iapTunnel.zone,
                instance: e.iapTunnel.instance,
                encoding: globalEncoding,
            };
            // Fall back to a generated label when the tree node has no name
            // (e.g. the user double-clicked an unnamed entry created from the
            // host-tree "+" modal). An empty tab title is unfriendly.
            const fallbackName = `IAP ${e.iapTunnel.instance}`;
            const displayName = node.name?.trim() || fallbackName;
            onConnect({ displayName, protocol: 'gcloud-iap', config });
            return;
        }

        let u = e.username ?? '';
        let p = e.password ?? '';

        const cached = getCachedCredential(node.id);
        const needsDecryption: (string | undefined)[] = [undefined, undefined];
        if (isEncrypted(u)) {
            if (cached?.username !== undefined) u = cached.username;
            else needsDecryption[0] = u;
        }
        if (isEncrypted(p)) {
            if (cached?.password !== undefined) p = cached.password;
            else needsDecryption[1] = p;
        }
        if (needsDecryption.some(val => val !== undefined)) {
            const [decU, decP] = await decryptBatch(needsDecryption);
            if (decU !== undefined) u = decU;
            if (decP !== undefined) p = decP;
        }

        const sshKeepAlive = settings.sshKeepAliveEnabled ? settings.sshKeepAliveInterval : 0;
        const telnetKeepAlive = settings.telnetKeepAliveEnabled ? settings.telnetKeepAliveInterval : 0;
        const sshConnectTimeout = settings.sshConnectTimeoutSecs;
        const telnetConnectTimeout = settings.telnetConnectTimeoutSecs;

        let payload: ConnectSubmitPayload;
        if (e.protocol === 'ssh') {
            const config: SshConnectionConfig = {
                host: e.host,
                port: e.port,
                username: u,
                password: p || undefined,
                encoding: globalEncoding,
                keepaliveIntervalSecs: sshKeepAlive,
                connectTimeoutSecs: sshConnectTimeout,
            };
            payload = { displayName: node.name, protocol: 'ssh', config };
        } else {
            const config: TelnetConnectionConfig = {
                host: e.host,
                port: e.port,
                username: u || undefined,
                password: p || undefined,
                encoding: globalEncoding,
                keepaliveIntervalSecs: telnetKeepAlive,
                connectTimeoutSecs: telnetConnectTimeout,
            };
            payload = { displayName: node.name, protocol: 'telnet', config };
        }
        onConnect(payload);
    }, [onConnect, settings.sshKeepAliveEnabled, settings.sshKeepAliveInterval, settings.telnetKeepAliveEnabled, settings.telnetKeepAliveInterval, settings.sshConnectTimeoutSecs, settings.telnetConnectTimeoutSecs]);

    // --- Dirty check ---
    const isDirty = originalState !== null && (
        originalState.name !== displayName ||
        originalState.protocol !== protocol ||
        originalState.host !== host ||
        originalState.port !== String(port) ||
        originalState.username !== username ||
        originalState.password !== password ||
        originalState.isJumpbox !== isJumpbox ||
        originalState.jumpboxId !== jumpboxId ||
        originalState.iapProject !== iapProject ||
        originalState.iapZone !== iapZone ||
        originalState.iapInstance !== iapInstance
    );

    // --- Save changes to host entry ---
    const handleSave = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedHostId || !isDirty) return;

        let finalU = username;
        let finalP = password;

        if (isEncrypted(finalU) || isEncrypted(finalP)) {
            const cached = getCachedCredential(selectedHostId);
            const needsDecryption = [undefined, undefined] as (string | undefined)[];
            if (isEncrypted(finalU)) {
                if (cached?.username !== undefined) finalU = cached.username;
                else needsDecryption[0] = finalU;
            }
            if (isEncrypted(finalP)) {
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

        setOriginalState({
            name: displayName,
            protocol,
            host,
            port: String(port),
            username: finalU,
            password: finalP,
            isJumpbox,
            jumpboxId,
            iapProject,
            iapZone,
            iapInstance,
        });

        const isIapProto = protocol === 'gcloud-iap';
        const entry: HostEntry = {
            protocol: protocol as 'ssh' | 'telnet' | 'gcloud-iap',
            host: isIapProto ? iapInstance : host,
            port: parseInt(port),
            username: isIapProto ? undefined : (protocol === 'ssh' || protocol === 'telnet') ? finalU : undefined,
            password: isIapProto ? undefined : (protocol === 'ssh' || protocol === 'telnet') ? finalP : undefined,
            isJumpbox: protocol === 'ssh' ? (isJumpbox || undefined) : undefined,
            jumpboxId: isIapProto ? undefined : (jumpboxId || undefined),
            iapTunnel: isIapProto ? { project: iapProject, zone: iapZone, instance: iapInstance } : undefined,
        };

        hostManager.editNode(selectedHostId, { name: displayName, entry });
    };

    // --- Submit: connect ---
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Front-end validation. Catches obvious mistakes (empty host, bad
        // port, malformed GCP IDs, CRLF injection) before the backend has to.
        const validationError = ((): string | null => {
            if (protocol === 'gcloud-iap') {
                const projectOk = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(iapProject);
                const zoneOk = /^[a-z]+-[a-z]+[0-9]+-[a-z]$/.test(iapZone);
                const instanceOk = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/.test(iapInstance);
                if (!projectOk) {
                    return 'IAP project ID must be 6-30 chars, lowercase alphanumeric or hyphen, starting with a letter.';
                }
                if (!zoneOk) return 'IAP zone is invalid (e.g., us-central1-a).';
                if (!instanceOk) return 'IAP instance name is invalid (lowercase letters/digits/hyphens, must start with a letter, max 63 chars).';
                return null;
            }
            if (protocol === 'ssh' || protocol === 'telnet') {
                const h = host.trim();
                if (!h) return 'Host is required.';
                if (/[\s\r\n\0]/.test(h)) return 'Host contains invalid whitespace or newline characters.';
                const p = parseInt(port, 10);
                if (!Number.isInteger(p) || p < 1 || p > 65535) {
                    return 'Port must be an integer between 1 and 65535.';
                }
                if (protocol === 'ssh' && !username.trim()) {
                    return 'Username is required for SSH.';
                }
                if (/[\r\n\0]/.test(username)) {
                    return 'Username contains invalid newline characters.';
                }
            }
            return null;
        })();
        if (validationError) {
            // Surface inline; keep modal open so the user can correct.
            window.alert(validationError);
            return;
        }

        let finalU = username;
        let finalP = password;
        if (isEncrypted(finalU) || isEncrypted(finalP)) {
            const cached = selectedHostId ? getCachedCredential(selectedHostId) : undefined;
            const needsDecryption = [undefined, undefined] as (string | undefined)[];
            if (isEncrypted(finalU)) {
                if (cached?.username !== undefined) finalU = cached.username;
                else needsDecryption[0] = finalU;
            }
            if (isEncrypted(finalP)) {
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

        // Persist credential changes back to the selected tree node
        if (selectedHostId && (protocol === 'ssh' || protocol === 'telnet' || protocol === 'gcloud-iap')) {
            const isIapProto = protocol === 'gcloud-iap';
            const entry: HostEntry = {
                protocol: protocol as 'ssh' | 'telnet' | 'gcloud-iap',
                host: isIapProto ? iapInstance : host,
                port: parseInt(port),
                username: isIapProto ? undefined : (protocol === 'ssh' || protocol === 'telnet') ? finalU : undefined,
                password: isIapProto ? undefined : (protocol === 'ssh' || protocol === 'telnet') ? finalP : undefined,
                isJumpbox: protocol === 'ssh' ? (isJumpbox || undefined) : undefined,
                jumpboxId: isIapProto ? undefined : (jumpboxId || undefined),
                iapTunnel: isIapProto ? { project: iapProject, zone: iapZone, instance: iapInstance } : undefined,
            };
            const patchTree = (nodes: HostTreeNode[], id: string): HostTreeNode[] =>
                nodes.map(n => {
                    if (n.id === id) return { ...n, entry };
                    if (n.children) return { ...n, children: patchTree(n.children, id) };
                    return n;
                });
            await hostManager.saveTree(patchTree(hostManager.tree, selectedHostId));
        }

        const sshKeepAlive = settings.sshKeepAliveEnabled ? settings.sshKeepAliveInterval : 0;
        const telnetKeepAlive = settings.telnetKeepAliveEnabled ? settings.telnetKeepAliveInterval : 0;
        const sshConnectTimeout = settings.sshConnectTimeoutSecs;
        const telnetConnectTimeout = settings.telnetConnectTimeoutSecs;
        const buildName = (): string => {
            if (displayName) return displayName;
            switch (protocol) {
                case 'ssh':
                case 'telnet': {
                    const u = finalU.trim();
                    return `${protocol.toUpperCase()} ${u ? u + '@' : ''}${host.trim()}:${port}`;
                }
                case 'gcloud-iap':
                    return `IAP ${iapInstance.trim()}`;
                case 'serial':
                    return `Serial ${serialPath} (${baudRate})`;
                case 'wsl':
                    return `WSL ${selectedDistro}`;
                case 'cmd':
                    return 'Command Prompt';
                case 'powershell':
                    return 'PowerShell';
                case 'git-bash':
                    return 'Git Bash';
            }
        };

        switch (protocol) {
            case 'gcloud-iap': {
                const config: GcloudIapConnectionConfig = {
                    project: iapProject.trim(),
                    zone: iapZone.trim(),
                    instance: iapInstance.trim(),
                    encoding,
                };
                onConnect({ displayName: buildName(), protocol, config });
                break;
            }
            case 'ssh': {
                const config: SshConnectionConfig = {
                    host: host.trim(),
                    port: parseInt(port),
                    username: finalU.trim(),
                    password: finalP || undefined,
                    privateKeyPath: privateKeyPath || undefined,
                    privateKeyPassphrase: privateKeyPassphrase || undefined,
                    encoding,
                    keepaliveIntervalSecs: sshKeepAlive,
                    connectTimeoutSecs: sshConnectTimeout,
                };
                onConnect({ displayName: buildName(), protocol, config });
                break;
            }
            case 'telnet': {
                const config: TelnetConnectionConfig = {
                    host: host.trim(),
                    port: parseInt(port),
                    username: finalU.trim() || undefined,
                    password: finalP || undefined,
                    encoding,
                    keepaliveIntervalSecs: telnetKeepAlive,
                    connectTimeoutSecs: telnetConnectTimeout,
                };
                onConnect({ displayName: buildName(), protocol, config });
                break;
            }
            case 'serial': {
                const config: SerialConnectionConfig = {
                    path: serialPath.trim(),
                    baudRate: parseInt(baudRate, 10),
                    dataBits,
                    parity,
                    stopBits,
                    flowControl,
                    encoding,
                };
                onConnect({ displayName: buildName(), protocol, config });
                break;
            }
            case 'wsl': {
                const config: WslConnectionConfig = {
                    distribution: selectedDistro,
                    encoding,
                };
                onConnect({ displayName: buildName(), protocol, config });
                break;
            }
            case 'cmd':
            case 'powershell':
            case 'git-bash': {
                const config: LocalConnectionConfig = {
                    shellType: protocol === 'cmd' ? 'cmd' : protocol === 'powershell' ? 'powershell' : 'git-bash',
                    shellPath: protocol === 'git-bash' && gitBashPath ? gitBashPath : undefined,
                    encoding,
                };
                onConnect({ displayName: buildName(), protocol, config });
                break;
            }
        }
    };

    const handleBrowseKey = async () => {
        const selected = await open({
            multiple: false,
            directory: false,
            title: 'Select private key file',
        });
        if (typeof selected === 'string') {
            setPrivateKeyPath(selected);
        }
    };

    const canSubmit = (() => {
        switch (protocol) {
            case 'ssh':
                return host.trim().length > 0 && parseInt(port) > 0 && parseInt(port) <= 65535 && username.trim().length > 0;
            case 'telnet':
                return host.trim().length > 0 && parseInt(port) > 0 && parseInt(port) <= 65535;
            case 'gcloud-iap':
                return iapProject.trim().length > 0 && iapZone.trim().length > 0 && iapInstance.trim().length > 0;
            case 'serial':
                return serialPath.trim().length > 0;
            case 'wsl':
                return selectedDistro.length > 0;
            case 'cmd':
            case 'powershell':
                return true;
            case 'git-bash':
                return gitBashPath !== null && gitBashPath !== '';
        }
    })();

    if (!isOpen) return null;

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
                onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('.form-panel, .host-tree-row, .host-tree-toolbar, .context-menu, .host-edit-modal-overlay')) return;
                    resetForm();
                }}
            >
                {/* Drag handle */}
                <div
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '40px', cursor: 'grab', zIndex: 0 }}
                    onMouseDown={handleHeaderMouseDown}
                />
                <button
                    className="session-dialog-close"
                    onClick={onClose}
                >{'\u2715'}</button>

                <h2 style={{ marginTop: 0, paddingRight: '20px', marginBottom: '10px' }}>New Session</h2>

                {/* Two-panel body */}
                <div className="dialog-body">
                    {/* Left: Host tree */}
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
                        />
                    </div>

                    {/* Divider */}
                    <div className="panel-divider" onMouseDown={handlePanelDividerMouseDownWrapped} />

                    {/* Right: Connection form */}
                    <div className="form-panel">
                        <form ref={formRef} onSubmit={handleSubmit}>
                            <fieldset disabled={isDecrypting} style={{ border: 'none', padding: 0, margin: 0 }}>
                                {/* Display Name (only when a host is selected) */}
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

                                {/* Protocol */}
                                <div className="form-group">
                                    <label>Protocol</label>
                                    <select
                                        value={protocol}
                                        onChange={(e) => {
                                            const p = e.target.value as ProtocolId;
                                            setProtocol(p);
                                            if (p === 'ssh') setPort('22');
                                            else if (p === 'telnet') setPort('23');
                                            if (p !== 'ssh') setIsJumpbox(false);
                                            if (p !== 'ssh' && p !== 'telnet') setJumpboxId('');
                                        }}
                                    >
                                        {PROTOCOLS.map(p => (
                                            <option key={p.value} value={p.value}>{p.label}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Jumpbox checkbox */}
                                {selectedHostId && protocol === 'ssh' && (
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

                                {/* IAP tunnel fields */}
                                {protocol === 'gcloud-iap' && (
                                    <>
                                        <div className="form-group">
                                            {iapCheckingGcloud ? (
                                                <span style={{ fontSize: 'calc(var(--font-size-base) - 2px)', color: 'var(--text-secondary)' }}>
                                                    Checking gcloud SDK...
                                                </span>
                                            ) : iapCheckingAuth ? (
                                                <span style={{ fontSize: 'calc(var(--font-size-base) - 2px)', color: 'var(--text-secondary)' }}>
                                                    Checking authentication...
                                                </span>
                                            ) : iapGcloudStatus && !iapGcloudStatus.available ? (
                                                <span style={{ fontSize: 'calc(var(--font-size-base) - 2px)', color: 'var(--color-danger)' }}>
                                                    gcloud SDK not found.{' '}
                                                    <a
                                                        href="#"
                                                        onClick={(ev) => { ev.preventDefault(); tauriService.openExternal('https://cloud.google.com/sdk/docs/install'); }}
                                                        style={{ color: 'var(--accent-color)' }}
                                                    >
                                                        Install
                                                    </a>
                                                </span>
                                            ) : iapAuthStatus && !iapAuthStatus.authenticated ? (
                                                <span style={{ fontSize: 'calc(var(--font-size-base) - 2px)', color: 'var(--color-warning)' }}>
                                                    Not authenticated. Run <code>gcloud auth login</code> first.
                                                </span>
                                            ) : iapAuthStatus?.authenticated ? (
                                                <span style={{ fontSize: 'calc(var(--font-size-base) - 2px)', color: 'var(--success-color)' }}>
                                                    Authenticated as {iapAuthStatus.account}
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className="form-group">
                                            <label>GCP Project{iapLoadingProjects && <span style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}> (loading...)</span>}</label>
                                            {iapProjects.length > 0 ? (
                                                <select value={iapProject} onChange={e => setIapProject(e.target.value)} required>
                                                    <option value="">Select a project</option>
                                                    {iapProjects.map(p => (
                                                        <option key={p.id} value={p.id}>{p.name !== p.id ? `${p.name} (${p.id})` : p.id}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input type="text" value={iapProject} onChange={e => setIapProject(e.target.value)} placeholder="my-project-id" required />
                                            )}
                                        </div>
                                        <div className="form-group">
                                            <label>Zone{iapLoadingZones && <span style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}> (loading...)</span>}</label>
                                            {iapZones.length > 0 ? (
                                                <select value={iapZone} onChange={e => setIapZone(e.target.value)} required>
                                                    <option value="">Select a zone</option>
                                                    {iapZones.map(z => (
                                                        <option key={z} value={z}>{z}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input type="text" value={iapZone} onChange={e => setIapZone(e.target.value)} placeholder="us-central1-a" required />
                                            )}
                                        </div>
                                        <div className="form-group">
                                            <label>Instance{iapLoadingInstances && <span style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}> (loading...)</span>}</label>
                                            {iapInstances.length > 0 ? (
                                                <select value={iapInstance} onChange={e => setIapInstance(e.target.value)} required>
                                                    <option value="">Select an instance</option>
                                                    {iapInstances.map(i => (
                                                        <option key={i.name} value={i.name}>{`${i.name} (${i.status})`}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input type="text" value={iapInstance} onChange={e => setIapInstance(e.target.value)} placeholder="my-instance" required />
                                            )}
                                        </div>
                                        <div className="form-group" style={{ marginTop: '4px' }}>
                                            <span style={{
                                                fontSize: 'calc(var(--font-size-base) - 2px)',
                                                color: 'var(--text-secondary)',
                                                fontStyle: 'italic',
                                            }}>
                                                Authentication is handled automatically by gcloud (OS Login / SSH key auto-generation at ~/.ssh/google_compute_engine). No username, password, or private key is required.
                                            </span>
                                        </div>
                                    </>
                                )}

                                {/* SSH/Telnet fields */}
                                {NETWORK_PROTOCOLS.has(protocol) && (
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
                                        <div className="form-group">
                                            <label>Password</label>
                                            <input
                                                type="password"
                                                value={isDecrypting ? 'Decrypting...' : password}
                                                onChange={e => setPassword(e.target.value)}
                                                className={isDecrypting ? 'decrypting-placeholder' : ''}
                                                disabled={isDecrypting}
                                                autoComplete="new-password"
                                            />
                                        </div>
                                        {jumpboxHosts.length > 0 && (
                                            <div className="form-group">
                                                <label>Jumpbox (Bastion)</label>
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

                                {/* SSH-specific fields */}
                                {protocol === 'ssh' && (
                                    <>
                                        <div className="form-group">
                                            <label>Private Key Path (optional)</label>
                                            <div className="connect-form-inline">
                                                <input
                                                    type="text"
                                                    value={privateKeyPath}
                                                    onChange={(e) => setPrivateKeyPath(e.target.value)}
                                                    placeholder="~/.ssh/id_rsa"
                                                />
                                                <button
                                                    type="button"
                                                    className="btn-secondary"
                                                    onClick={handleBrowseKey}
                                                >
                                                    Browse...
                                                </button>
                                            </div>
                                        </div>
                                        <div className="form-group">
                                            <label>Private Key Passphrase</label>
                                            <input
                                                type="password"
                                                value={privateKeyPassphrase}
                                                onChange={(e) => setPrivateKeyPassphrase(e.target.value)}
                                            />
                                        </div>
                                    </>
                                )}

                                {/* Serial fields */}
                                {protocol === 'serial' && (
                                    <>
                                        <div className="form-group">
                                            <label>Serial Port</label>
                                            {serialPorts.length > 0 ? (
                                                <select value={serialPath} onChange={(e) => setSerialPath(e.target.value)}>
                                                    {serialPorts.map((p) => (
                                                        <option key={p.path} value={p.path}>
                                                            {p.displayName ? `${p.path} (${p.displayName})` : p.path}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={serialPath}
                                                    onChange={(e) => setSerialPath(e.target.value)}
                                                    placeholder="COM3"
                                                    autoFocus
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

                                {/* Git Bash warning */}
                                {protocol === 'git-bash' && gitBashPath === '' && (
                                    <div className="form-group">
                                        <div style={{ color: 'var(--color-warning)', fontSize: 'calc(var(--font-size-base) - 1px)', fontStyle: 'italic' }}>
                                            Git Bash is not installed.
                                        </div>
                                    </div>
                                )}

                                {/* Encoding */}
                                <div className="form-group">
                                    <label>Encoding</label>
                                    <select
                                        value={encoding}
                                        onChange={(e) => setEncoding(e.target.value as Encoding)}
                                    >
                                        <option value="utf8">UTF-8</option>
                                        <option value="shift_jis">Shift_JIS</option>
                                        <option value="euc-jp">EUC-JP</option>
                                    </select>
                                </div>
                            </fieldset>

                            <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center' }}>
                                {originalState !== null && NETWORK_PROTOCOLS.has(protocol) && (
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        onClick={handleSave}
                                        disabled={!isDirty || isDecrypting}
                                        title={isDirty ? 'Save changes to this host' : 'No changes to save'}
                                    >
                                        Save
                                    </button>
                                )}
                                <button
                                    type="submit"
                                    className="btn-primary"
                                    disabled={!canSubmit || isDecrypting || (protocol === 'git-bash' && gitBashPath === '')}
                                >
                                    Connect
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                {/* Resize handle */}
                <div className="dialog-resize-handle" onMouseDown={handleDialogResizeMouseDown} />
            </div>
        </div>
    );
};
