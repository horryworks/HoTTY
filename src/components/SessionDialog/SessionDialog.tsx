import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import { useHostManager, decryptBatch, getCachedCredential, clearDecryptedCache, flattenHosts } from '../../hooks/useHostManager';
import { type FixedSizeTri, triToBool, boolToTri } from '../../utils/fixedTerminalSize';
import { resolveIapUsername } from '../../utils/iapUsername';
import { isEncrypted } from '../../services/tauriService';
import { tauriService } from '../../services/tauriService';
import { HostTree } from '../HostTree/HostTree';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import { GcpInstancesPane, type VmSelection } from '../GcpInstancesPane/GcpInstancesPane';
import { BookmarkTree } from '../BookmarkTree/BookmarkTree';
import { flattenBookmarks } from '../BookmarkTree/bookmarkTreeHelpers';
import { useSidebarLayoutStore } from '../../stores/sidebarLayoutStore';
import { useResize } from '../../hooks/useResize';
import { useSettingsStore } from '../../stores/settingsStore';
import type { SessionRecord } from '../../hooks/useSessionManager';
import type { HostTreeNode, HostEntry, ProtocolId, Encoding, BookmarkNode } from '../../types/appTypes';
import type {
    SshConnectionConfig,
    TelnetConnectionConfig,
    SerialConnectionConfig,
    WslConnectionConfig,
    LocalConnectionConfig,
    GcloudIapConnectionConfig,
    SerialPortInfo,
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
    /** Host-tree node id when the connection originated from a saved host, so a
     *  later fixed-size toggle can persist back onto that entry. */
    hostNodeId?: string;
}

interface SessionDialogProps {
    open: boolean;
    onClose: () => void;
    /**
     * Initiates the connection attempt. The returned id (when provided) lets
     * this dialog watch `sessions` for the resulting session transitioning to
     * 'connected', so it can clear the New Connection draft only on a
     * verified success — auth failures must preserve the form for retry.
     */
    onConnect: (payload: ConnectSubmitPayload) => string | null | void;
    /**
     * Called once a session initiated via `onConnect` reaches 'connected'.
     * The host reveals + activates the pane, closes the dialog, and focuses
     * the terminal. The dialog stays open until this fires (or the attempt
     * fails / is cancelled), so the user waits inside the dialog.
     */
    onConnected?: (sessionId: string) => void;
    /**
     * Called when the user cancels an in-progress connection. The host tears
     * down the never-revealed session (disconnects the backend / cancels a
     * pending host-key prompt). The dialog itself stays open and editable.
     */
    onCancelConnect?: (sessionId: string) => void;
    /**
     * Sessions map from the host app. Used to observe the status of sessions
     * initiated via `onConnect` so the dialog can react to 'connected'
     * vs 'error'/'disconnected' transitions. Optional — when omitted the
     * dialog falls back to never clearing on connect.
     */
    sessions?: Map<string, SessionRecord>;
    /** Open a Web Browser pane from the Web tab and close the dialog. With a URL
     *  (a bookmark) it loads that site; without one it opens a blank tab. */
    onOpenBookmark?: (url?: string) => void;
}

const PROTOCOLS: { value: ProtocolId; label: string }[] = [
    { value: 'ssh', label: 'SSH' },
    { value: 'telnet', label: 'Telnet' },
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
    onConnected,
    onCancelConnect,
    sessions,
    onOpenBookmark,
}) => {
    const { t } = useTranslation();
    const hostManager = useHostManager();
    const settings = useSettingsStore();
    const activeSidebarTab = useSidebarLayoutStore((s) => s.activeSidebarTab);
    const setActiveSidebarTab = useSidebarLayoutStore((s) => s.setActiveSidebarTab);
    // The Web (bookmarks) tab follows the Settings → Features "Web Browser" toggle.
    const webEnabled = settings.enabledFeatures['web-browser'];

    const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
    const [isDecrypting, setIsDecrypting] = useState(false);

    // Connection-in-progress tracking. While a session initiated from this
    // dialog is negotiating, `connectingSessionId` holds its id and the form
    // shows a "connecting" state (Connect → spinner, Cancel visible). On
    // failure the humanized reason is captured into `connectError` and shown
    // inline while the form stays editable for retry.
    const [connectingSessionId, setConnectingSessionId] = useState<string | null>(null);
    const [connectError, setConnectError] = useState<string | null>(null);
    const isConnecting = connectingSessionId !== null;
    // Coarse GCP/IAP pre-flight phase (resolving/enrolling/tunnel/authenticating)
    // shown next to the connecting spinner. Null for non-IAP connects.
    const [iapPhase, setIapPhase] = useState<string | null>(null);

    // Ref to the connection form for programmatic submission
    const formRef = useRef<HTMLFormElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const selectedHostIdRef = useRef<string | null>(null);
    useEffect(() => {
        selectedHostIdRef.current = selectedHostId;
    }, [selectedHostId]);
    // Mirror into a ref so the document-level keydown handler (which is only
    // re-subscribed on isOpen/onClose changes) always sees the live value.
    const connectingSessionIdRef = useRef<string | null>(null);
    useEffect(() => {
        connectingSessionIdRef.current = connectingSessionId;
    }, [connectingSessionId]);

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
    // Per-connection "fixed terminal size" override (SSH/Telnet). 'default' follows
    // the global setting; 'on'/'off' force it for this connection/host.
    const [fixedTerminalSize, setFixedTerminalSize] = useState<FixedSizeTri>('default');

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
        privateKeyPath: string;
        privateKeyPassphrase: string;
        fixedTerminalSize: FixedSizeTri;
    } | null>(null);

    // Per-modal-session draft for unsaved New Connection input. When the user
    // navigates from New Connection to a saved host, the in-progress form is
    // stashed here so they can come back to it via the banner × or pseudo-row.
    // Cleared on a successful connect.
    type NewConnectionDraft = {
        displayName: string;
        host: string;
        port: string;
        username: string;
        password: string;
        protocol: ProtocolId;
        isJumpbox: boolean;
        jumpboxId: string;
        privateKeyPath: string;
        privateKeyPassphrase: string;
        serialPath: string;
        baudRate: string;
        dataBits: string;
        parity: string;
        stopBits: string;
        flowControl: string;
        selectedDistro: string;
        encoding: Encoding;
        fixedTerminalSize: FixedSizeTri;
    };
    const [newConnectionDraft, setNewConnectionDraft] = useState<NewConnectionDraft | null>(null);

    // Session ids initiated from this dialog, mapped to a "keep form on connect"
    // flag. The subscription effect below (placed after resetForm because the
    // success branch uses it) watches the parent's `sessions` map. On a verified
    // 'connected' it resets the form ONLY when keepForm is false — a New
    // Connection (manual entry) keeps its values so the next open is pre-filled
    // for a similar host, while saved-host / GCP connects reset as before (their
    // decrypted plaintext password must not linger). Auth failures never reset,
    // so the user can fix credentials and retry.
    const initiatedSessionsRef = useRef<Map<string, boolean>>(new Map());

    // Set true once the active connecting session has been observed in the
    // `sessions` map at least once; guards the "record vanished" failure branch
    // against the brief window before the parent propagates the new record.
    const connectingSeenRef = useRef(false);

    const dispatchConnect = useCallback((payload: ConnectSubmitPayload, keepFormOnConnect = false) => {
        const result = onConnect(payload);
        if (typeof result === 'string' && result.length > 0) {
            initiatedSessionsRef.current.set(result, keepFormOnConnect);
            // Enter the in-dialog "connecting" state; the watch effect drives the
            // rest (close + focus on 'connected', inline error on failure).
            connectingSeenRef.current = false;
            setConnectError(null);
            setIapPhase(null);
            setConnectingSessionId(result);
        }
    }, [onConnect]);

    // Abort an in-progress connection: ask the host to tear down the
    // never-revealed session, then return the form to an editable state.
    // The dialog itself stays open (the user can fix and retry, or close).
    const handleCancelConnect = useCallback(() => {
        const id = connectingSessionIdRef.current;
        if (!id) return;
        onCancelConnect?.(id);
        initiatedSessionsRef.current.delete(id);
        setConnectingSessionId(null);
    }, [onCancelConnect]);

    // Available jumpbox hosts
    const jumpboxHosts = useMemo(() =>
        flattenHosts(hostManager.tree).filter(n => n.entry?.isJumpbox && n.entry.protocol === 'ssh'),
        [hostManager.tree]
    );

    // --- Keyboard handling ---
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            // Ignore keys while a nested modal is up — including the SSH host-key
            // prompt, which can appear over this dialog mid-connect.
            if (document.querySelector('.host-edit-modal-overlay, .confirm-modal-overlay, .ssh-host-key-overlay')) return;
            const connecting = connectingSessionIdRef.current !== null;
            if (e.key === 'Escape') {
                e.preventDefault();
                // While connecting, Esc cancels the attempt (dialog stays open);
                // otherwise it closes the dialog.
                if (connecting) handleCancelConnect();
                else onClose();
                return;
            }
            if (e.key !== 'Enter') return;
            // Don't re-submit while a connection is already in progress.
            if (connecting) return;
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
    }, [isOpen, onClose, handleCancelConnect]);

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
        // Reset protocol to the New Connection default alongside its default
        // port. Resetting port to '22' without resetting protocol left a stale
        // protocol (e.g. telnet) paired with SSH's port — the "Telnet but port
        // 22" bug — because port only re-derives from the protocol <select>'s
        // onChange, not from a programmatic setProtocol.
        setProtocol('ssh');
        setPort('22');
        setUsername('');
        setPassword('');
        setIsJumpbox(false);
        setJumpboxId('');
        setPrivateKeyPath('');
        setPrivateKeyPassphrase('');
        setFixedTerminalSize('default');
    }, []);

    // Subscription effect: watches the parent's sessions map for any session
    // initiated from this dialog transitioning to 'connected'. For saved-host /
    // GCP connects (keepForm === false) it clears the form + draft as before;
    // for a New Connection (keepForm === true) it keeps the entered values so
    // the next open is pre-filled for a similar host. Failure paths
    // ('error'/'disconnected') stop tracking but always preserve user input.
    useEffect(() => {
        if (!sessions) return;
        /* eslint-disable react-hooks/set-state-in-effect */

        // Drive the in-dialog connecting/error UI for the active attempt.
        const activeId = connectingSessionId;
        if (activeId) {
            const rec = sessions.get(activeId);
            if (rec) connectingSeenRef.current = true;
            const status = rec?.status;
            if (status === 'connected') {
                // Established: hand off to the host (reveal pane + close + focus).
                setConnectError(null);
                setConnectingSessionId(null);
                onConnected?.(activeId);
            } else if (status === 'error' || status === 'disconnected') {
                // Failed: show the humanized reason inline; keep the form editable.
                setConnectError(rec?.errorMessage || t('sessionDialog.connectFailedGeneric'));
                setConnectingSessionId(null);
            } else if (!rec && connectingSeenRef.current) {
                // The record vanished (e.g. externally closed) before we saw a
                // terminal status — surface a generic failure rather than
                // spinning forever. The `seen` guard avoids the brief pre-propagation window.
                setConnectError(t('sessionDialog.connectFailedGeneric'));
                setConnectingSessionId(null);
            }
        }

        // Keep-form-on-connect reset semantics (independent of the UI above).
        for (const [id, keepForm] of Array.from(initiatedSessionsRef.current)) {
            const status = sessions.get(id)?.status;
            if (status === 'connected') {
                if (!keepForm) {
                    setNewConnectionDraft(null);
                    resetForm();
                }
                initiatedSessionsRef.current.delete(id);
            } else if (status === 'error' || status === 'disconnected') {
                initiatedSessionsRef.current.delete(id);
            }
        }
        /* eslint-enable react-hooks/set-state-in-effect */
    }, [sessions, resetForm, connectingSessionId, onConnected, t]);

    // Clear transient connection state when the dialog closes so a stale
    // "connecting" spinner or error message never bleeds into the next open.
    useEffect(() => {
        if (isOpen) return;
        /* eslint-disable react-hooks/set-state-in-effect */
        setConnectingSessionId(null);
        setConnectError(null);
        setIapPhase(null);
        /* eslint-enable react-hooks/set-state-in-effect */
    }, [isOpen]);

    // Subscribe to GCP/IAP connect-phase progress so the connecting spinner shows
    // a live phase label ("Registering SSH key…", "Starting IAP tunnel…", …)
    // instead of a static "Connecting…" during the long IAP pre-flight.
    useEffect(() => {
        let unlisten: undefined | (() => void);
        let cancelled = false;
        (async () => {
            const un = await tauriService.onIapConnectProgress((p) => {
                if (p.sessionId === connectingSessionIdRef.current) {
                    setIapPhase(p.phase);
                }
            });
            if (cancelled) {
                un();
                return;
            }
            unlisten = un;
        })();
        return () => {
            cancelled = true;
            if (unlisten) unlisten();
        };
    }, []);

    // --- Select a host from the tree ---
    const handleSelectHost = async (node: HostTreeNode) => {
        setSelectedHostId(node.id);
        if (node.type !== 'host' || !node.entry) {
            setOriginalState(null);
            setDisplayName('');
            setHost('');
            // Keep protocol/port in sync (see resetForm) — resetting port to
            // '22' without resetting protocol leaves a stale telnet + port 22.
            setProtocol('ssh');
            setPort('22');
            setUsername('');
            setPassword('');
            setIsJumpbox(false);
            setJumpboxId('');
            setPrivateKeyPath('');
            setPrivateKeyPassphrase('');
            setFixedTerminalSize('default');
            return;
        }

        // Legacy gcloud-iap entries are no longer editable from the Hosts tab —
        // creation/edit moved to the GCP tab and only supports one-shot
        // connections. Show the selection visually but leave the form blank so
        // the user doesn't accidentally save destructive changes.
        if (node.entry.protocol === 'gcloud-iap') {
            setOriginalState(null);
            setDisplayName(node.name);
            return;
        }

        const e = node.entry;
        setProtocol(e.protocol);
        setHost(e.host ?? '');
        setPort(String(e.port ?? (e.protocol === 'ssh' ? 22 : 23)));

        let u = e.username ?? '';
        let p = e.password ?? '';
        let kpp = e.privateKeyPassphrase ?? '';

        const cached = getCachedCredential(node.id);

        const needsDecryption: (string | undefined)[] = [undefined, undefined, undefined];
        if (isEncrypted(u)) {
            if (cached?.username !== undefined) u = cached.username;
            else needsDecryption[0] = u;
        }
        if (isEncrypted(p)) {
            if (cached?.password !== undefined) p = cached.password;
            else needsDecryption[1] = p;
        }
        if (isEncrypted(kpp)) {
            if (cached?.privateKeyPassphrase !== undefined) kpp = cached.privateKeyPassphrase;
            else needsDecryption[2] = kpp;
        }

        if (needsDecryption.some(val => val !== undefined)) {
            setIsDecrypting(true);
            const [decU, decP, decKpp] = await decryptBatch(needsDecryption);
            if (decU !== undefined) u = decU;
            if (decP !== undefined) p = decP;
            if (decKpp !== undefined) kpp = decKpp;
            setIsDecrypting(false);
        }

        setUsername(u);
        setPassword(p);
        setIsJumpbox(!!e.isJumpbox);
        setJumpboxId(e.jumpboxId ?? '');
        setPrivateKeyPath(e.privateKeyPath ?? '');
        setPrivateKeyPassphrase(kpp);
        const fixedTri = boolToTri(e.fixedTerminalSize);
        setFixedTerminalSize(fixedTri);

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
            privateKeyPath: e.privateKeyPath ?? '',
            privateKeyPassphrase: kpp,
            fixedTerminalSize: fixedTri,
        });
    };

    // --- GCP discovery tab: double-click connects immediately ---
    const handleActivateGcpInstance = useCallback(
        (sel: VmSelection) => {
            const { globalEncoding, gcpIapUsername } = useSettingsStore.getState();
            const config: GcloudIapConnectionConfig = {
                project: sel.project,
                zone: sel.zone,
                instance: sel.instance,
                encoding: globalEncoding,
                // Default to auto-start for one-shot connections from the GCP
                // tab — the user explicitly chose this VM, so prompting again
                // would be churn.
                autoStart: true,
                username: resolveIapUsername(undefined, gcpIapUsername),
            };
            dispatchConnect({
                displayName: `IAP ${sel.instance}`,
                protocol: 'gcloud-iap',
                config,
            }, false);
        },
        [dispatchConnect],
    );

    // --- Web tab: open a Web Browser pane (bookmark URL or blank), then close ---
    const handleOpenBookmarkFromDialog = useCallback(
        (url?: string) => {
            onOpenBookmark?.(url);
            onClose();
        },
        [onOpenBookmark, onClose],
    );

    // "Open All": open every bookmark beneath a folder (recursively) as new
    // browser panes, then close the dialog once (not per item).
    const handleOpenAllBookmarks = useCallback(
        (folder: BookmarkNode) => {
            for (const b of flattenBookmarks(folder.children ?? [])) {
                if (b.url) onOpenBookmark?.(b.url);
            }
            onClose();
        },
        [onOpenBookmark, onClose],
    );

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
                autoStart: !!e.iapTunnel.autoStart,
                // IAP entries never carry an encrypted username (gcloud handles
                // auth), so this fast path needs no decryption.
                username: resolveIapUsername(
                    e.username,
                    useSettingsStore.getState().gcpIapUsername,
                ),
            };
            // Fall back to a generated label when the tree node has no name
            // (e.g. the user double-clicked an unnamed entry created from the
            // host-tree "+" modal). An empty tab title is unfriendly.
            const fallbackName = `IAP ${e.iapTunnel.instance}`;
            const displayName = node.name?.trim() || fallbackName;
            dispatchConnect({ displayName, protocol: 'gcloud-iap', config }, false);
            return;
        }

        let u = e.username ?? '';
        let p = e.password ?? '';
        let kpp = e.privateKeyPassphrase ?? '';

        const cached = getCachedCredential(node.id);
        const needsDecryption: (string | undefined)[] = [undefined, undefined, undefined];
        if (isEncrypted(u)) {
            if (cached?.username !== undefined) u = cached.username;
            else needsDecryption[0] = u;
        }
        if (isEncrypted(p)) {
            if (cached?.password !== undefined) p = cached.password;
            else needsDecryption[1] = p;
        }
        if (isEncrypted(kpp)) {
            if (cached?.privateKeyPassphrase !== undefined) kpp = cached.privateKeyPassphrase;
            else needsDecryption[2] = kpp;
        }
        if (needsDecryption.some(val => val !== undefined)) {
            const [decU, decP, decKpp] = await decryptBatch(needsDecryption);
            if (decU !== undefined) u = decU;
            if (decP !== undefined) p = decP;
            if (decKpp !== undefined) kpp = decKpp;
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
                privateKeyPath: e.privateKeyPath || undefined,
                privateKeyPassphrase: kpp || undefined,
                encoding: globalEncoding,
                keepaliveIntervalSecs: sshKeepAlive,
                connectTimeoutSecs: sshConnectTimeout,
                fixedTerminalSize: e.fixedTerminalSize,
            };
            payload = { displayName: node.name, protocol: 'ssh', config, hostNodeId: node.id };
        } else {
            const config: TelnetConnectionConfig = {
                host: e.host,
                port: e.port,
                username: u || undefined,
                password: p || undefined,
                encoding: globalEncoding,
                keepaliveIntervalSecs: telnetKeepAlive,
                connectTimeoutSecs: telnetConnectTimeout,
                fixedTerminalSize: e.fixedTerminalSize,
            };
            payload = { displayName: node.name, protocol: 'telnet', config, hostNodeId: node.id };
        }
        dispatchConnect(payload, false);
    }, [dispatchConnect, settings.sshKeepAliveEnabled, settings.sshKeepAliveInterval, settings.telnetKeepAliveEnabled, settings.telnetKeepAliveInterval, settings.sshConnectTimeoutSecs, settings.telnetConnectTimeoutSecs]);

    // --- "Open All": connect every host beneath a folder (recursively) ---
    // Reuses the single-host path per host. Sequential `await` keeps any DPAPI
    // decrypt prompts from overlapping. The first connect closes this dialog, but
    // `dispatchConnect → onConnect` lives in App, so the rest still open.
    const handleOpenAllHostsInFolder = useCallback(async (folder: HostTreeNode) => {
        for (const host of flattenHosts(folder.children ?? [])) {
            await handleDoubleClickHost(host);
        }
    }, [handleDoubleClickHost]);

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
        originalState.privateKeyPath !== privateKeyPath ||
        originalState.privateKeyPassphrase !== privateKeyPassphrase ||
        originalState.fixedTerminalSize !== fixedTerminalSize
    );

    // When no host is selected, dirty means the user has typed something into
    // the main connection fields. Used to gate the discard-confirmation when
    // switching to a different target.
    const hasUnselectedFieldFilled = !!(
        displayName.trim() ||
        host.trim() ||
        username.trim() ||
        password ||
        jumpboxId ||
        isJumpbox ||
        privateKeyPath.trim() ||
        privateKeyPassphrase
    );

    // --- Switch-target flow (banner ×, tree pseudo-row, other-host click) ---
    type SwitchTarget = { kind: 'new' } | { kind: 'host'; node: HostTreeNode };
    const [pendingSwitch, setPendingSwitch] = useState<SwitchTarget | null>(null);

    const captureDraft = (): NewConnectionDraft => ({
        displayName, host, port, username, password, protocol,
        isJumpbox, jumpboxId, privateKeyPath, privateKeyPassphrase,
        serialPath, baudRate, dataBits, parity, stopBits, flowControl,
        selectedDistro, encoding, fixedTerminalSize,
    });

    const restoreDraft = (draft: NewConnectionDraft) => {
        setSelectedHostId(null);
        setOriginalState(null);
        setDisplayName(draft.displayName);
        setHost(draft.host);
        setPort(draft.port);
        setUsername(draft.username);
        setPassword(draft.password);
        setProtocol(draft.protocol);
        setIsJumpbox(draft.isJumpbox);
        setJumpboxId(draft.jumpboxId);
        setPrivateKeyPath(draft.privateKeyPath);
        setPrivateKeyPassphrase(draft.privateKeyPassphrase);
        setSerialPath(draft.serialPath);
        setBaudRate(draft.baudRate);
        setDataBits(draft.dataBits);
        setParity(draft.parity);
        setStopBits(draft.stopBits);
        setFlowControl(draft.flowControl);
        setSelectedDistro(draft.selectedDistro);
        setEncoding(draft.encoding);
        setFixedTerminalSize(draft.fixedTerminalSize);
    };

    const applySwitch = (target: SwitchTarget) => {
        const leavingNew = originalState === null;
        const goingNew = target.kind === 'new';

        // Stash the unsaved New Connection input before navigating away so the
        // user can recover it via the banner × / pseudo-row later.
        if (leavingNew && !goingNew && hasUnselectedFieldFilled) {
            setNewConnectionDraft(captureDraft());
        }

        if (target.kind === 'new') {
            if (newConnectionDraft) {
                restoreDraft(newConnectionDraft);
                setNewConnectionDraft(null);
            } else {
                resetForm();
            }
        } else {
            void handleSelectHost(target.node);
        }
    };

    const requestSwitchTarget = (target: SwitchTarget) => {
        // Selecting the already-selected host is a no-op; don't prompt.
        if (target.kind === 'host' && target.node.id === selectedHostId) {
            applySwitch(target);
            return;
        }
        // Already in New Connection mode and there's no draft to restore — no-op.
        if (target.kind === 'new' && selectedHostId === null) {
            return;
        }
        // Only confirm when editing a saved host with unsaved changes. New
        // Connection input is preserved via the draft, so no prompt is needed.
        if (originalState !== null && isDirty) {
            setPendingSwitch(target);
        } else {
            applySwitch(target);
        }
    };

    const handleHostTreeSelect = (node: HostTreeNode) => requestSwitchTarget({ kind: 'host', node });
    const handleNewConnectionRequest = () => requestSwitchTarget({ kind: 'new' });

    // --- Save changes to host entry ---
    const handleSave = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedHostId || !isDirty) return;

        let finalU = username;
        let finalP = password;
        let finalKpp = privateKeyPassphrase;

        if (isEncrypted(finalU) || isEncrypted(finalP) || isEncrypted(finalKpp)) {
            const cached = getCachedCredential(selectedHostId);
            const needsDecryption = [undefined, undefined, undefined] as (string | undefined)[];
            if (isEncrypted(finalU)) {
                if (cached?.username !== undefined) finalU = cached.username;
                else needsDecryption[0] = finalU;
            }
            if (isEncrypted(finalP)) {
                if (cached?.password !== undefined) finalP = cached.password;
                else needsDecryption[1] = finalP;
            }
            if (isEncrypted(finalKpp)) {
                if (cached?.privateKeyPassphrase !== undefined) finalKpp = cached.privateKeyPassphrase;
                else needsDecryption[2] = finalKpp;
            }
            if (needsDecryption.some(val => val !== undefined)) {
                setIsDecrypting(true);
                const [decU, decP, decKpp] = await decryptBatch(needsDecryption);
                if (decU !== undefined) { finalU = decU; setUsername(decU); }
                if (decP !== undefined) { finalP = decP; setPassword(decP); }
                if (decKpp !== undefined) { finalKpp = decKpp; setPrivateKeyPassphrase(decKpp); }
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
            privateKeyPath,
            privateKeyPassphrase: finalKpp,
            fixedTerminalSize,
        });

        const isSsh = protocol === 'ssh';
        const entry: HostEntry = {
            protocol: protocol as 'ssh' | 'telnet',
            host,
            port: parseInt(port),
            username: (isSsh || protocol === 'telnet') ? finalU : undefined,
            password: (isSsh || protocol === 'telnet') ? finalP : undefined,
            isJumpbox: isSsh ? (isJumpbox || undefined) : undefined,
            jumpboxId: jumpboxId || undefined,
            privateKeyPath: isSsh ? (privateKeyPath || undefined) : undefined,
            privateKeyPassphrase: isSsh ? (finalKpp || undefined) : undefined,
            fixedTerminalSize: triToBool(fixedTerminalSize),
        };

        hostManager.editNode(selectedHostId, { name: displayName, entry });
    };

    // --- Submit: connect ---
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // A connection is already in progress — ignore re-submits (Enter key,
        // double-click) until it resolves or is cancelled.
        if (connectingSessionIdRef.current !== null) return;
        // Clear any prior failure so a fresh attempt starts with a clean slate.
        setConnectError(null);

        // Front-end validation. Catches obvious mistakes (empty host, bad
        // port, CRLF injection) before the backend has to.
        const validationError = ((): string | null => {
            if (protocol === 'ssh' || protocol === 'telnet') {
                const h = host.trim();
                if (!h) return t('sessionDialog.validation.hostRequired');
                if (/[\s\r\n\0]/.test(h)) return t('sessionDialog.validation.hostInvalidWhitespace');
                const p = parseInt(port, 10);
                if (!Number.isInteger(p) || p < 1 || p > 65535) {
                    return t('sessionDialog.validation.portRange');
                }
                if (protocol === 'ssh' && !username.trim()) {
                    return t('sessionDialog.validation.usernameRequiredSsh');
                }
                if (/[\r\n\0]/.test(username)) {
                    return t('sessionDialog.validation.usernameInvalidNewline');
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
        // Resolve the SSH key passphrase too — not just username/password.
        // Omitting it meant an encrypted passphrase was handed to the backend
        // verbatim, so key auth failed for any host whose passphrase was stored
        // encrypted. Mirrors handleSave's three-credential resolution.
        let finalKpp = privateKeyPassphrase;
        if (isEncrypted(finalU) || isEncrypted(finalP) || isEncrypted(finalKpp)) {
            const cached = selectedHostId ? getCachedCredential(selectedHostId) : undefined;
            const needsDecryption = [undefined, undefined, undefined] as (string | undefined)[];
            if (isEncrypted(finalU)) {
                if (cached?.username !== undefined) finalU = cached.username;
                else needsDecryption[0] = finalU;
            }
            if (isEncrypted(finalP)) {
                if (cached?.password !== undefined) finalP = cached.password;
                else needsDecryption[1] = finalP;
            }
            if (isEncrypted(finalKpp)) {
                if (cached?.privateKeyPassphrase !== undefined) finalKpp = cached.privateKeyPassphrase;
                else needsDecryption[2] = finalKpp;
            }
            if (needsDecryption.some(val => val !== undefined)) {
                setIsDecrypting(true);
                const [decU, decP, decKpp] = await decryptBatch(needsDecryption);
                if (decU !== undefined) { finalU = decU; setUsername(decU); }
                if (decP !== undefined) { finalP = decP; setPassword(decP); }
                if (decKpp !== undefined) { finalKpp = decKpp; setPrivateKeyPassphrase(decKpp); }
                setIsDecrypting(false);
            }
        }

        // Persist credential changes back to the selected tree node. This rebuilds
        // the entry from scratch (does NOT spread the old one), so every field the
        // user can set — including fixedTerminalSize — must be included or it is
        // silently dropped on connect.
        if (selectedHostId && (protocol === 'ssh' || protocol === 'telnet')) {
            const isSsh = protocol === 'ssh';
            const entry: HostEntry = {
                protocol: protocol as 'ssh' | 'telnet',
                host,
                port: parseInt(port),
                username: finalU,
                password: finalP,
                isJumpbox: isSsh ? (isJumpbox || undefined) : undefined,
                jumpboxId: jumpboxId || undefined,
                privateKeyPath: isSsh ? (privateKeyPath || undefined) : undefined,
                privateKeyPassphrase: isSsh ? (finalKpp || undefined) : undefined,
                fixedTerminalSize: triToBool(fixedTerminalSize),
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
                // gcloud-iap is not configurable from this form; the GCP tab
                // owns IAP connections. Treat as no-op for type exhaustiveness.
                case 'gcloud-iap':
                    return displayName || 'IAP';
            }
        };

        // A New Connection (no saved host selected) keeps its form values after
        // a successful connect so the next open is pre-filled for a similar host.
        // Editing/connecting a saved host resets as before.
        const isNewConnection = selectedHostId === null;

        switch (protocol) {
            case 'ssh': {
                const config: SshConnectionConfig = {
                    host: host.trim(),
                    port: parseInt(port),
                    username: finalU.trim(),
                    password: finalP || undefined,
                    privateKeyPath: privateKeyPath || undefined,
                    privateKeyPassphrase: finalKpp || undefined,
                    encoding,
                    keepaliveIntervalSecs: sshKeepAlive,
                    connectTimeoutSecs: sshConnectTimeout,
                    fixedTerminalSize: triToBool(fixedTerminalSize),
                };
                dispatchConnect(
                    { displayName: buildName(), protocol, config, hostNodeId: selectedHostId ?? undefined },
                    isNewConnection
                );
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
                    fixedTerminalSize: triToBool(fixedTerminalSize),
                };
                dispatchConnect(
                    { displayName: buildName(), protocol, config, hostNodeId: selectedHostId ?? undefined },
                    isNewConnection
                );
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
                dispatchConnect({ displayName: buildName(), protocol, config }, isNewConnection);
                break;
            }
            case 'wsl': {
                const config: WslConnectionConfig = {
                    distribution: selectedDistro,
                    encoding,
                };
                dispatchConnect({ displayName: buildName(), protocol, config }, isNewConnection);
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
                dispatchConnect({ displayName: buildName(), protocol, config }, isNewConnection);
                break;
            }
        }

        // Form values intentionally persist across modal close — auth
        // success/failure is reported asynchronously by the backend, so the
        // form stays around for retry. For a New Connection they also persist
        // after a *successful* connect (keepForm=true above) so the next open is
        // pre-filled for a similar host; only saved-host connects are reset by
        // the sessions subscription effect above on 'connected'.
    };

    const handleBrowseKey = async () => {
        const selected = await open({
            multiple: false,
            directory: false,
            title: t('sessionDialog.browseKeyTitle'),
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
                // Not selectable from the Hosts-tab dropdown; the GCP tab
                // bypasses this form entirely.
                return false;
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
                    if (target.closest('.form-panel, .host-tree-row, .host-tree-toolbar, .context-menu, .host-edit-modal-overlay, .confirm-modal-overlay')) return;
                    handleNewConnectionRequest();
                }}
            >
                {/* Drag handle */}
                <div
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '40px', cursor: 'grab', zIndex: 0 }}
                    onMouseDown={handleHeaderMouseDown}
                />
                <button
                    className="session-dialog-close"
                    onClick={() => { if (isConnecting) handleCancelConnect(); else onClose(); }}
                >{'\u2715'}</button>

                <h2 style={{ marginTop: 0, paddingRight: '20px', marginBottom: '10px' }}>{t('sessionDialog.title')}</h2>

                <div className={`dialog-body tab-${activeSidebarTab}`}>
                    {/* Left: Host tree / GCP discovery tabs */}
                    <div className="host-panel" style={{ flex: 1, minWidth: 0 }}>
                        <div className="host-panel-tabs" role="tablist" aria-label={t('sessionDialog.tabs.sourceAriaLabel')}>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={activeSidebarTab === 'hosts'}
                                className={`host-panel-tab${activeSidebarTab === 'hosts' ? ' active' : ''}`}
                                onClick={() => setActiveSidebarTab('hosts')}
                            >
                                <span aria-hidden="true">📡 </span>{t('sessionDialog.tabs.hosts')}
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={activeSidebarTab === 'gcp'}
                                className={`host-panel-tab${activeSidebarTab === 'gcp' ? ' active' : ''}`}
                                onClick={() => setActiveSidebarTab('gcp')}
                            >
                                <span aria-hidden="true">☁ </span>{t('sessionDialog.tabs.gcp')}
                            </button>
                            {webEnabled && (
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={activeSidebarTab === 'web'}
                                    className={`host-panel-tab${activeSidebarTab === 'web' ? ' active' : ''}`}
                                    onClick={() => setActiveSidebarTab('web')}
                                >
                                    <span aria-hidden="true">🌐 </span>{t('sessionDialog.tabs.web')}
                                </button>
                            )}
                        </div>
                        {/* Dialog-level connect status — rendered outside the tab
                            content so the "Connecting…" spinner + Cancel appear no
                            matter which tab (Hosts / GCP / Web) started the connect. */}
                        {(isConnecting || connectError) && (
                            <div
                                className={`connect-status connect-status-dialog${connectError ? ' connect-status-error' : ''}`}
                                aria-live="assertive"
                                role={connectError ? 'alert' : undefined}
                            >
                                {isConnecting ? (
                                    <>
                                        <span className="connect-spinner" aria-hidden="true" />
                                        <span className="connect-status-text">
                                            {iapPhase === 'resolving'
                                                ? t('sessionDialog.iapPhase.resolving')
                                                : iapPhase === 'enrolling'
                                                    ? t('sessionDialog.iapPhase.enrolling')
                                                    : iapPhase === 'tunnel'
                                                        ? t('sessionDialog.iapPhase.tunnel')
                                                        : iapPhase === 'authenticating'
                                                            ? t('sessionDialog.iapPhase.authenticating')
                                                            : t('sessionDialog.connecting')}
                                        </span>
                                        <button
                                            type="button"
                                            className="btn-secondary connect-cancel-btn"
                                            onClick={handleCancelConnect}
                                        >
                                            {t('common.cancel')}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <span className="connect-status-label">{t('sessionDialog.connectFailed')}</span>
                                        <span className="connect-status-reason">{connectError}</span>
                                    </>
                                )}
                            </div>
                        )}
                        {activeSidebarTab === 'hosts' || (activeSidebarTab === 'web' && !webEnabled) ? (
                            <div className="hosts-tab-content">
                                <div className="hosts-tab-tree" style={{ width: treePanelWidth, flexShrink: 0 }}>
                                    <HostTree
                                        tree={hostManager.tree}
                                        selectedId={selectedHostId}
                                        onSelect={handleHostTreeSelect}
                                        onNewConnection={handleNewConnectionRequest}
                                        onDoubleClickHost={handleDoubleClickHost}
                                        onOpenAllInFolder={handleOpenAllHostsInFolder}
                                        onAddFolder={hostManager.addFolder}
                                        onAddHost={hostManager.addHost}
                                        onEditNode={hostManager.editNode}
                                        onDeleteNode={hostManager.deleteNode}
                                        onMoveNode={hostManager.moveNode}
                                        onSortFolder={hostManager.sortFolder}
                                        onImportData={hostManager.importData}
                                    />
                                </div>
                                <div className="panel-divider" onMouseDown={handlePanelDividerMouseDownWrapped} />
                                <div className="form-panel">
                        <div className="form-status-banner" aria-live="polite">
                            {selectedHostId === null ? (
                                <span className="banner-new">
                                    <span aria-hidden="true">{'\u{1F195} '}</span>{t('sessionDialog.banner.newConnection')}
                                </span>
                            ) : (
                                <>
                                    <span className="banner-editing">
                                        <span aria-hidden="true">{'\u{1F4DD} '}</span>
                                        {t('sessionDialog.banner.editing')} <span className="banner-editing-name">{displayName || t('sessionDialog.banner.unnamed')}</span>
                                    </span>
                                    <button
                                        type="button"
                                        className="banner-clear-btn"
                                        onClick={handleNewConnectionRequest}
                                        title={t('sessionDialog.banner.startNewTitle')}
                                        aria-label={t('sessionDialog.banner.clearAriaLabel')}
                                    >{'✕'}</button>
                                </>
                            )}
                        </div>
                        <form ref={formRef} onSubmit={handleSubmit}>
                            <fieldset disabled={isDecrypting} style={{ border: 'none', padding: 0, margin: 0 }}>
                                {/* Display Name (only when a host is selected) */}
                                {originalState !== null && (
                                    <div className="form-group">
                                        <label>{t('sessionDialog.nameLabel')}</label>
                                        <input
                                            type="text"
                                            value={displayName}
                                            onChange={e => setDisplayName(e.target.value)}
                                            placeholder={t('sessionDialog.namePlaceholder')}
                                        />
                                    </div>
                                )}

                                {/* Protocol */}
                                <div className="form-group">
                                    <label>{t('sessionDialog.protocolLabel')}</label>
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
                                            {t('sessionDialog.useAsJumpbox')}
                                        </label>
                                    </div>
                                )}

                                {/* SSH/Telnet fields */}
                                {NETWORK_PROTOCOLS.has(protocol) && (
                                    <>
                                        <div className="form-row">
                                            <div className="form-group" style={{ flex: 3 }}>
                                                <label>{t('sessionDialog.hostLabel')}</label>
                                                <input
                                                    type="text"
                                                    value={host}
                                                    onChange={e => setHost(e.target.value)}
                                                    placeholder={t('sessionDialog.hostPlaceholder')}
                                                    required
                                                    autoFocus
                                                />
                                            </div>
                                            <div className="form-group" style={{ flex: 1 }}>
                                                <label>{t('sessionDialog.portLabel')}</label>
                                                <input
                                                    type="number"
                                                    value={port}
                                                    onChange={e => setPort(e.target.value)}
                                                    required
                                                />
                                            </div>
                                        </div>
                                        <div className="form-group">
                                            <label>{t('sessionDialog.usernameLabel')}</label>
                                            <input
                                                type="text"
                                                value={isDecrypting ? t('sessionDialog.decrypting') : username}
                                                onChange={e => setUsername(e.target.value)}
                                                className={isDecrypting ? 'decrypting-placeholder' : ''}
                                                disabled={isDecrypting}
                                                autoComplete="off"
                                                required={protocol === 'ssh'}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>{t('sessionDialog.passwordLabel')}</label>
                                            <input
                                                type="password"
                                                value={isDecrypting ? t('sessionDialog.decrypting') : password}
                                                onChange={e => setPassword(e.target.value)}
                                                className={isDecrypting ? 'decrypting-placeholder' : ''}
                                                disabled={isDecrypting}
                                                autoComplete="new-password"
                                            />
                                        </div>
                                        {jumpboxHosts.length > 0 && (
                                            <div className="form-group">
                                                <label>{t('sessionDialog.jumpboxLabel')}</label>
                                                <select
                                                    value={jumpboxId}
                                                    onChange={e => setJumpboxId(e.target.value)}
                                                >
                                                    <option value="">{t('sessionDialog.directConnection')}</option>
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
                                            <label>{t('sessionDialog.privateKeyPathLabel')}</label>
                                            <div className="connect-form-inline">
                                                <input
                                                    type="text"
                                                    value={privateKeyPath}
                                                    onChange={(e) => setPrivateKeyPath(e.target.value)}
                                                    placeholder={t('sessionDialog.privateKeyPathPlaceholder')}
                                                />
                                                <button
                                                    type="button"
                                                    className="btn-secondary"
                                                    onClick={handleBrowseKey}
                                                >
                                                    {t('common.browse')}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="form-group">
                                            <label>{t('sessionDialog.privateKeyPassphraseLabel')}</label>
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
                                            <label>{t('sessionDialog.serialPortLabel')}</label>
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
                                                    placeholder={t('sessionDialog.serialPortPlaceholder')}
                                                    autoFocus
                                                />
                                            )}
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group form-group-half">
                                                <label>{t('sessionDialog.baudRateLabel')}</label>
                                                <select value={baudRate} onChange={(e) => setBaudRate(e.target.value)}>
                                                    <option value="9600">9600</option>
                                                    <option value="19200">19200</option>
                                                    <option value="38400">38400</option>
                                                    <option value="57600">57600</option>
                                                    <option value="115200">115200</option>
                                                </select>
                                            </div>
                                            <div className="form-group form-group-half">
                                                <label>{t('sessionDialog.dataBitsLabel')}</label>
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
                                                <label>{t('sessionDialog.parityLabel')}</label>
                                                <select value={parity} onChange={(e) => setParity(e.target.value)}>
                                                    <option value="none">{t('sessionDialog.parity.none')}</option>
                                                    <option value="odd">{t('sessionDialog.parity.odd')}</option>
                                                    <option value="even">{t('sessionDialog.parity.even')}</option>
                                                    <option value="mark">{t('sessionDialog.parity.mark')}</option>
                                                    <option value="space">{t('sessionDialog.parity.space')}</option>
                                                </select>
                                            </div>
                                            <div className="form-group form-group-half">
                                                <label>{t('sessionDialog.stopBitsLabel')}</label>
                                                <select value={stopBits} onChange={(e) => setStopBits(e.target.value)}>
                                                    <option value="1">1</option>
                                                    <option value="1.5">1.5</option>
                                                    <option value="2">2</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="form-group">
                                            <label>{t('sessionDialog.flowControlLabel')}</label>
                                            <select value={flowControl} onChange={(e) => setFlowControl(e.target.value)}>
                                                <option value="none">{t('sessionDialog.flowControl.none')}</option>
                                                <option value="xon/xoff">XON/XOFF</option>
                                                <option value="rts/cts">RTS/CTS</option>
                                            </select>
                                        </div>
                                    </>
                                )}

                                {/* WSL fields */}
                                {protocol === 'wsl' && (
                                    <div className="form-group">
                                        <label>{t('sessionDialog.distributionLabel')}</label>
                                        {wslDistros.length > 0 ? (
                                            <select value={selectedDistro} onChange={e => setSelectedDistro(e.target.value)}>
                                                {wslDistros.map(d => <option key={d} value={d}>{d}</option>)}
                                            </select>
                                        ) : (
                                            <div style={{ color: 'var(--text-secondary)', fontSize: 'calc(var(--font-size-base) - 1px)', fontStyle: 'italic' }}>
                                                {t('sessionDialog.noWslDistros')}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Git Bash warning */}
                                {protocol === 'git-bash' && gitBashPath === '' && (
                                    <div className="form-group">
                                        <div style={{ color: 'var(--color-warning)', fontSize: 'calc(var(--font-size-base) - 1px)', fontStyle: 'italic' }}>
                                            {t('sessionDialog.gitBashNotInstalled')}
                                        </div>
                                    </div>
                                )}

                                {/* Encoding */}
                                <div className="form-group">
                                    <label>{t('sessionDialog.encodingLabel')}</label>
                                    <select
                                        value={encoding}
                                        onChange={(e) => setEncoding(e.target.value as Encoding)}
                                    >
                                        <option value="utf8">UTF-8</option>
                                        <option value="shift_jis">Shift_JIS</option>
                                        <option value="euc-jp">EUC-JP</option>
                                    </select>
                                </div>

                                {/* Fixed terminal size (SSH/Telnet) — pins the grid to the
                                    connect-time width for devices that ignore later resizes. */}
                                {(protocol === 'ssh' || protocol === 'telnet') && (
                                    <div className="form-group">
                                        <label>{t('sessionDialog.fixedTerminalSizeLabel')}</label>
                                        <select
                                            value={fixedTerminalSize}
                                            onChange={(e) => setFixedTerminalSize(e.target.value as FixedSizeTri)}
                                        >
                                            <option value="default">{t('sessionDialog.fixedTerminalSizeDefault')}</option>
                                            <option value="on">{t('sessionDialog.fixedTerminalSizeOn')}</option>
                                            <option value="off">{t('sessionDialog.fixedTerminalSizeOff')}</option>
                                        </select>
                                    </div>
                                )}
                            </fieldset>

                            <div className="form-actions">
                                {originalState !== null && NETWORK_PROTOCOLS.has(protocol) && (
                                    <button
                                        type="button"
                                        className="btn-secondary"
                                        onClick={handleSave}
                                        disabled={!isDirty || isDecrypting}
                                        title={isDirty ? t('sessionDialog.saveTitleDirty') : t('sessionDialog.saveTitleClean')}
                                    >
                                        {t('common.save')}
                                    </button>
                                )}
                                <button
                                    type="submit"
                                    className="btn-primary"
                                    disabled={!canSubmit || isDecrypting || isConnecting || (protocol === 'git-bash' && gitBashPath === '')}
                                >
                                    {isConnecting ? t('sessionDialog.connecting') : t('sessionDialog.connect')}
                                </button>
                            </div>
                        </form>
                    </div>
                            </div>
                        ) : activeSidebarTab === 'gcp' ? (
                            <GcpInstancesPane
                                onActivateInstance={handleActivateGcpInstance}
                            />
                        ) : (
                            <BookmarkTree
                                onOpenBookmark={handleOpenBookmarkFromDialog}
                                onNewBlank={() => handleOpenBookmarkFromDialog()}
                                onOpenAll={handleOpenAllBookmarks}
                            />
                        )}
                    </div>
                </div>

                {/* Resize handle */}
                <div className="dialog-resize-handle" onMouseDown={handleDialogResizeMouseDown} />

                {pendingSwitch && (
                    <ConfirmModal
                        title={t('sessionDialog.discard.title')}
                        message={t('sessionDialog.discard.message')}
                        confirmLabel={t('sessionDialog.discard.confirmLabel')}
                        onConfirm={() => {
                            const target = pendingSwitch;
                            setPendingSwitch(null);
                            applySwitch(target);
                        }}
                        onCancel={() => setPendingSwitch(null)}
                    />
                )}
            </div>
        </div>
    );
};
