import React, { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { HostTreeNode, HostEntry } from '../../types/appTypes';
import { type FixedSizeTri, triToBool } from '../../utils/fixedTerminalSize';
import { filterHostTree } from '../../utils/hostTreeFilter';
import { flattenHosts, getJumpboxReferences } from '../../hooks/useHostManager';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useModalState } from '../../hooks/useModalState';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import { MoveByPrefixModal } from '../MoveByPrefixModal/MoveByPrefixModal';
import { isNetboxNamed } from '../../utils/netboxSync';
import { nodeIcon } from '../../utils/nodeIcon';
import {
    collectPrefixFolders,
    findParentFolderId,
    suggestFolderForHost,
    type PlacementResult,
    type PrefixFolder,
} from '../../utils/netboxPlacement';
import { formatPrefix } from '../../utils/cidr';
import type { PlacementMove } from '../../hooks/useHostManager';
import { tauriService } from '../../services/tauriService';
import './HostTree.css';

interface ContextMenuState {
    x: number;
    y: number;
    node: HostTreeNode | null;
}

/** "Open All" asks for confirmation once a folder holds at least this many hosts,
 *  guarding against accidentally launching a large batch of connections. */
const OPEN_ALL_CONFIRM_THRESHOLD = 5;

interface EditModalState {
    mode: 'folder' | 'host' | 'export' | 'import';
    parentId: string | null;
    existingNode?: HostTreeNode;
}

interface HostTreeProps {
    tree: HostTreeNode[];
    selectedId: string | null;
    onSelect: (node: HostTreeNode) => void;
    onNewConnection?: () => void;
    onDoubleClickHost?: (node: HostTreeNode) => void;
    onOpenAllInFolder?: (node: HostTreeNode) => void;
    onAddFolder: (parentId: string | null, name: string) => void;
    onAddHost: (parentId: string | null, name: string, entry: HostEntry) => void;
    onEditNode: (id: string, patch: Partial<HostTreeNode>) => void;
    onDeleteNode: (id: string) => void;
    onMoveNode?: (nodeId: string, targetId: string, position: 'before' | 'after' | 'inside') => void;
    onSortFolder?: (folderId: string | null, direction?: 'asc' | 'desc') => void;
    onImportData?: (nodes: HostTreeNode[], folderName: string, parentId: string | null) => Promise<string | undefined> | void;
    onShowMessage?: (type: 'error' | 'success' | 'info', title: string | undefined, message: string) => void;
    /** Run a NetBox sync. Absent when the integration is not configured. */
    onNetboxSync?: () => void;
    netboxSyncing?: boolean;
    /** A NetBox base URL is set, so the sync button is worth showing. */
    netboxConfigured?: boolean;
    /** Last sync failure, shown as a mark on the button rather than a popup. */
    netboxLastError?: string | null;
    /** Placement by NetBox IPAM prefix is on. Passed in rather than read from
     *  the store so this component stays presentational and its tests keep
     *  rendering it with plain props. */
    netboxPlacement?: boolean;
    /** Apply a batch of moves in one write. Absent ⇒ no bulk action offered. */
    onApplyPlacements?: (moves: PlacementMove[]) => number;
}

export const HostTree: React.FC<HostTreeProps> = ({
    tree,
    selectedId,
    onSelect,
    onNewConnection,
    onDoubleClickHost,
    onOpenAllInFolder,
    onAddFolder,
    onAddHost,
    onEditNode,
    onDeleteNode,
    onMoveNode,
    onSortFolder,
    onImportData,
    onShowMessage,
    onNetboxSync,
    netboxSyncing = false,
    netboxConfigured = false,
    netboxLastError = null,
    netboxPlacement = false,
    onApplyPlacements,
}) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [filterQuery, setFilterQuery] = useState('');
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [exportNode, setExportNode] = useState<HostTreeNode | null>(null);
    const [editModalOpen, openEditModal, closeEditModal, editModal] = useModalState<EditModalState>();
    const [nodeToDeleteOpen, openNodeToDelete, closeNodeToDelete, nodeToDelete] = useModalState<HostTreeNode>();
    const [openAllConfirmOpen, openOpenAllConfirm, closeOpenAllConfirm, openAllNode] = useModalState<HostTreeNode>();
    /** Scope for the bulk "sort by IP range" action: a folder id, or `null` for
     *  the whole tree. Held as `{ id }` so `null` stays a real value. */
    const [moveByPrefixScope, setMoveByPrefixScope] = useState<{ id: string | null } | null>(null);

    /**
     * Whether the suggestion in the add-host form is being used.
     *
     * `null` means "the user has not touched the choice", so the effective
     * value follows whatever the address currently matches. The moment a radio
     * is clicked it becomes a real boolean and editing the address again no
     * longer overrides what the user chose.
     */
    const [useNetboxFolder, setUseNetboxFolder] = useState<boolean | null>(null);

    // Inline edit state
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');

    const [formName, setFormName] = useState('');
    const [formProtocol, setFormProtocol] = useState<'ssh' | 'telnet'>('ssh');
    const [formHost, setFormHost] = useState('');
    const [formPort, setFormPort] = useState('22');
    const [formUsername, setFormUsername] = useState('');
    const [formPassword, setFormPassword] = useState('');
    const [formIsJumpbox, setFormIsJumpbox] = useState(false);
    const [formFixedTerminalSize, setFormFixedTerminalSize] = useState<FixedSizeTri>('default');
    const [importFilePath, setImportFilePath] = useState<string | null>(null);

    /** Every prefix-carrying folder, recomputed only when the tree changes. */
    const prefixFolders = useMemo(
        () => (netboxPlacement ? collectPrefixFolders(tree) : []),
        [tree, netboxPlacement],
    );

    /**
     * The "move this host into its IP-range folder" row, or `null` when there
     * is no row to show.
     *
     * Computed only while the menu is open on a host, so a folder or the empty
     * background costs nothing. Matched against the WHOLE tree's prefixes: a
     * single host has no subtree to narrow to, unlike the bulk action.
     *
     * A `null` target renders the row disabled rather than hiding it — "why did
     * this one not move?" is exactly the question a missing row cannot answer.
     * The row disappears only when the feature is off or nothing in the tree
     * carries a prefix, which is ADR-020's `noPrefixes` rule: a line about
     * matching is noise to someone who has not set the feature up.
     */
    const hostPlacementItem = useMemo((): {
        label: string;
        target: PrefixFolder | null;
    } | null => {
        const node = contextMenu?.node;
        if (!netboxPlacement || prefixFolders.length === 0) return null;
        if (!node || node.type !== 'host' || !node.entry) return null;

        const result = suggestFolderForHost(prefixFolders, node.entry.host);
        switch (result.kind) {
            case 'one': {
                const here = findParentFolderId(tree, node.id) ?? null;
                return result.folder.id === here
                    ? {
                        label: t('hostTree.contextMenu.moveAlreadyPlaced', {
                            name: result.folder.name,
                        }),
                        target: null,
                    }
                    : {
                        label: t('hostTree.contextMenu.moveToRange', {
                            name: result.folder.name,
                        }),
                        target: result.folder,
                    };
            }
            // Never split a tie (ADR-020): both names are shown, neither wins.
            case 'ambiguous':
                return {
                    label: t('hostTree.contextMenu.moveAmbiguous', {
                        names: result.folders.map((f) => f.name).join(', '),
                    }),
                    target: null,
                };
            case 'notAnAddress':
                return { label: t('hostTree.contextMenu.moveNotAnAddress'), target: null };
            // `noPrefixes` cannot reach here — `prefixFolders` is non-empty above.
            default:
                return { label: t('hostTree.contextMenu.moveNoMatch'), target: null };
        }
    }, [contextMenu, netboxPlacement, prefixFolders, tree, t]);

    /**
     * What the address typed into the add-host form matches.
     *
     * Only ever computed for a NEW host: silently relocating a host the user
     * opened to edit would cross the line this feature is careful to stay on
     * the right side of.
     */
    const placement: PlacementResult = useMemo(() => {
        if (!editModal || editModal.mode !== 'host' || editModal.existingNode) {
            return { kind: 'noPrefixes' };
        }
        return suggestFolderForHost(prefixFolders, formHost);
    }, [editModal, prefixFolders, formHost]);

    /** The folder to save into, or `null` to use the form's own parent. */
    const placementFolder =
        placement.kind === 'one' && (useNetboxFolder ?? true) ? placement.folder : null;

    /** Where the Add button would have put this host — named, so the radio can
     *  offer both destinations by name rather than one of them as "not that". */
    const currentParentName = useMemo(() => {
        const id = editModal?.parentId ?? null;
        if (id === null) return t('hostTree.netbox.placement.topLevel');
        const walk = (nodes: HostTreeNode[]): string | null => {
            for (const n of nodes) {
                if (n.id === id) return n.name;
                const hit = n.children ? walk(n.children) : null;
                if (hit !== null) return hit;
            }
            return null;
        };
        return walk(tree) ?? t('hostTree.netbox.placement.topLevel');
    }, [editModal, tree, t]);
    const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<{ nodeId: string; position: 'before' | 'after' | 'inside' } | null>(null);
    const modalInputRef = useRef<HTMLInputElement>(null);

    const focusModal = useCallback(() => {
        setTimeout(() => {
            if (modalInputRef.current) {
                modalInputRef.current.focus();
                try {
                    tauriService.focusWindow();
                    window.focus();
                } catch { /* focus best-effort */ }
            }
        }, 200);
    }, []);

    const containerRef = useRef<HTMLDivElement>(null);
    const editModalRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const filterInputRef = useRef<HTMLInputElement>(null);

    useFocusTrap(editModalRef, editModalOpen);

    /** The tree as the user currently sees it. An empty filter passes `tree`
     *  through by reference, so the common case costs nothing. */
    const isFiltering = filterQuery.trim() !== '';
    const visibleTree = useMemo(() => filterHostTree(tree, filterQuery), [tree, filterQuery]);

    /** Move focus to a rendered row so the arrow keys / Enter continue from
     *  there. The row is keyed by `data-node-id`; hosts carry `tabIndex={0}`. */
    const focusRow = useCallback((nodeId: string) => {
        const rows = containerRef.current?.querySelectorAll<HTMLElement>('.host-tree-row');
        if (!rows) return;
        for (const row of rows) {
            if (row.dataset.nodeId === nodeId) {
                row.focus();
                return;
            }
        }
    }, []);

    /** First host in the filtered tree, depth-first — what Enter selects. */
    const firstVisibleHost = useMemo(() => {
        const find = (nodes: HostTreeNode[]): HostTreeNode | null => {
            for (const n of nodes) {
                if (n.type === 'host') return n;
                const hit = n.children ? find(n.children) : null;
                if (hit) return hit;
            }
            return null;
        };
        return find(visibleTree);
    }, [visibleTree]);

    // Ctrl+F focuses the filter box.
    //
    // Registered on `window` in the CAPTURE phase on purpose: `usePaneFindShortcut`
    // owns Ctrl+F on `document` (also capture) and calls stopImmediatePropagation
    // without checking whether a modal is open, so a background pane would
    // otherwise swallow the chord. Capture descends window → document, so the
    // window listener wins. This component only exists while the New Session
    // dialog's Hosts tab is showing, which scopes the override for free.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.altKey || e.metaKey || e.shiftKey) return;
            if (!e.ctrlKey || (e.key !== 'f' && e.key !== 'F')) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            filterInputRef.current?.focus();
            filterInputRef.current?.select();
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, []);

    useEffect(() => {
        const handler = () => setContextMenu(null);
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, []);

    useEffect(() => {
        if (editModalOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setEditingNodeId(null);
            focusModal();
        }
    }, [editModalOpen, focusModal]);

    useLayoutEffect(() => {
        if (contextMenu && contextMenuRef.current) {
            const menu = contextMenuRef.current;
            const rect = menu.getBoundingClientRect();
            let adjustedX = contextMenu.x;
            let adjustedY = contextMenu.y;

            if (adjustedX + rect.width > window.innerWidth) {
                adjustedX = window.innerWidth - rect.width - 5;
            }
            if (adjustedY + rect.height > window.innerHeight) {
                adjustedY = window.innerHeight - rect.height - 5;
            }

            if (adjustedX !== contextMenu.x || adjustedY !== contextMenu.y) {
                menu.style.left = `${adjustedX}px`;
                menu.style.top = `${adjustedY}px`;
            }
        }
    }, [contextMenu]);

    // Folders render open until the user says otherwise, so an untouched folder
    // has no entry here at all. Flip against that default (`?? true`) — reading
    // the missing entry as `false` made the first click on a folder write `true`
    // and change nothing on screen, so it took two clicks to collapse.
    const toggle = (id: string) => setExpanded(prev => ({ ...prev, [id]: !(prev[id] ?? true) }));

    const getTargetParentId = useCallback(() => {
        if (!selectedId) return null;

        let targetParentId: string | null = null;
        const findNodeInfo = (nodes: HostTreeNode[], parentId: string | null): boolean => {
            for (const n of nodes) {
                if (n.id === selectedId) {
                    if (n.type === 'folder') {
                        targetParentId = n.id;
                    } else {
                        targetParentId = parentId;
                    }
                    return true;
                }
                if (n.children) {
                    if (findNodeInfo(n.children, n.id)) return true;
                }
            }
            return false;
        };

        findNodeInfo(tree, null);
        return targetParentId;
    }, [selectedId, tree]);

    const openContextMenu = useCallback((e: React.MouseEvent, node: HostTreeNode | null) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, node });
    }, []);

    const openAddFolder = useCallback((parentId: string | null) => {
        setFormName('');
        openEditModal({ mode: 'folder', parentId });
        setContextMenu(null);
    }, [openEditModal]);

    const openAddHost = useCallback((parentId: string | null) => {
        setFormName('');
        setFormProtocol('ssh');
        setFormHost('');
        setFormPort('22');
        setFormUsername('');
        setFormPassword('');
        setFormIsJumpbox(false);
        setFormFixedTerminalSize('default');
        setUseNetboxFolder(null);
        openEditModal({ mode: 'host', parentId });
        setContextMenu(null);
    }, [openEditModal]);

    // "Open All" on a folder: connect every host beneath it (recursively). Confirm
    // first when the batch is large; otherwise open straight away.
    const handleOpenAllClick = useCallback((node: HostTreeNode) => {
        setContextMenu(null);
        if (flattenHosts(node.children ?? []).length >= OPEN_ALL_CONFIRM_THRESHOLD) {
            openOpenAllConfirm(node);
        } else {
            onOpenAllInFolder?.(node);
        }
    }, [onOpenAllInFolder, openOpenAllConfirm]);

    const handleExport = (node: HostTreeNode | null = null) => {
        setExportNode(node);
        setFormName('');
        setFormPassword('');
        openEditModal({ mode: 'export', parentId: null });
        setContextMenu(null);
    };

    const handleImport = async (parentId: string | null = null) => {
        try {
            const filePath = await tauriService.selectImportFile();
            if (!filePath) return;
            setImportFilePath(filePath);
            setFormPassword('');
            openEditModal({ mode: 'import', parentId });
            setContextMenu(null);
        } catch (err: unknown) {
            onShowMessage?.('error', t('hostTree.messages.importErrorTitle'), t('hostTree.messages.importErrorBody', { error: err instanceof Error ? err.message : String(err) }));
        }
    };

    const handleModalSubmit = async () => {
        if (!editModal) return;
        const { mode, parentId, existingNode } = editModal;

        if (mode === 'export') {
            if (!formPassword) return;
            try {
                const dataToExport = exportNode ? [exportNode] : tree;
                const result = await tauriService.exportHtree(JSON.stringify(dataToExport), formPassword);

                closeEditModal();
                setExportNode(null);
                setFormPassword('');

                if (result.success) {
                    setTimeout(() => {
                        onShowMessage?.('success', t('hostTree.messages.exportSuccessTitle'), t('hostTree.messages.exportSuccessBody'));
                        focusModal();
                    }, 50);
                } else if (result.error) {
                    onShowMessage?.('error', t('hostTree.messages.exportFailedTitle'), result.error);
                }
            } catch (err: unknown) {
                onShowMessage?.('error', t('hostTree.messages.exportFailedTitle'), err instanceof Error ? err.message : String(err));
            }
            return;
        }

        if (mode === 'import') {
            if (!formPassword || !importFilePath) return;
            try {
                const rawData = await tauriService.decryptImportFile(formPassword);
                const data = JSON.parse(rawData) as HostTreeNode[];
                if (data && onImportData) {
                    const pathParts = importFilePath.split(/[\\/]/);
                    const fileNameWithExt = pathParts[pathParts.length - 1];
                    const fileName = fileNameWithExt.replace(/\.[^/.]+$/, "");

                    const currentParentId = parentId;
                    const folderId = await onImportData(data, currentParentId ? '' : `Imported_${fileName}`, currentParentId);

                    if (folderId) {
                        setExpanded(prev => ({ ...prev, [folderId]: true }));
                    }

                    closeEditModal();
                    setImportFilePath(null);
                    setFormPassword('');

                    setTimeout(() => {
                        onShowMessage?.('success', t('hostTree.messages.importSuccessTitle'), currentParentId ? t('hostTree.messages.importSuccessBody') : t('hostTree.messages.importSuccessIntoFolder', { folderName: `Imported_${fileName}` }));
                        focusModal();
                    }, 50);
                }
            } catch (err: unknown) {
                onShowMessage?.('error', t('hostTree.messages.importFailedTitle'), err instanceof Error ? err.message : String(err));
            }
            return;
        }

        const defaultPort = formProtocol === 'ssh' ? 22 : 23;
        const port = Number.parseInt(formPort, 10) || defaultPort;

        if (existingNode) {
            if (mode === 'folder') {
                onEditNode(existingNode.id, { name: formName });
            } else {
                // Spread the existing entry first so fields this add/edit form
                // does not surface — privateKeyPath, privateKeyPassphrase,
                // iapTunnel — are preserved rather than silently dropped on
                // save. The form fields then override only what they own.
                const entry: HostEntry = {
                    ...existingNode.entry,
                    protocol: formProtocol,
                    host: formHost,
                    port,
                    username: formUsername || undefined,
                    password: formPassword || undefined,
                    isJumpbox: formProtocol === 'ssh' ? (formIsJumpbox || undefined) : undefined,
                    fixedTerminalSize: triToBool(formFixedTerminalSize),
                };
                onEditNode(existingNode.id, { name: formName, entry });
            }
        } else {
            if (mode === 'folder') {
                onAddFolder(parentId, formName);
            } else {
                const entry: HostEntry = {
                    protocol: formProtocol,
                    host: formHost,
                    port,
                    username: formUsername || undefined,
                    password: formPassword || undefined,
                    isJumpbox: formProtocol === 'ssh' ? (formIsJumpbox || undefined) : undefined,
                    fixedTerminalSize: triToBool(formFixedTerminalSize),
                };
                // The NetBox folder only wins when it is both offered and
                // selected; otherwise this is exactly where the host would
                // have gone before.
                const suggested = placementFolder;
                if (suggested) {
                    onAddHost(suggested.id, formName, entry);
                    // ADR-018 (c): the tree's expanded state is component-local
                    // and the NetBox subtree is collapsed every time the dialog
                    // opens. Without this the new host lands inside a folded
                    // folder and the save looks like it did nothing.
                    setExpanded(prev => ({ ...prev, [suggested.id]: true }));
                } else {
                    onAddHost(parentId, formName, entry);
                }
            }
        }
        closeEditModal();
    };

    const renderNode = (node: HostTreeNode, depth: number): React.ReactNode => {
        // While filtering, every surviving folder is shown open — otherwise a
        // match hidden inside a folder the user had collapsed would not appear.
        // `expanded` itself is left untouched, so clearing the filter restores
        // exactly the open/closed state the user had.
        const isExpanded = isFiltering || (expanded[node.id] ?? true);
        const hasChildren = !!node.children && node.children.length > 0;
        const isSelected = selectedId === node.id;
        const isDragging = draggedNodeId === node.id;
        const isDropTarget = dropTarget?.nodeId === node.id;
        const dropPosition = isDropTarget ? dropTarget.position : null;

        const dragClasses = [
            isDragging ? 'dragging' : '',
            dropPosition === 'before' ? 'drag-over-before' : '',
            dropPosition === 'after' ? 'drag-over-after' : '',
            dropPosition === 'inside' ? 'drag-over-inside' : '',
        ].filter(Boolean).join(' ');

        return (
            <div key={node.id} className="host-tree-node">
                <div
                    className={`host-tree-row ${isSelected ? 'selected' : ''} ${dragClasses}${node.netbox ? ' netbox-managed' : ''}${node.netbox?.missing ? ' netbox-missing' : ''}`}
                    title={
                        node.netbox?.missing
                            ? t('hostTree.netbox.missingTitle')
                            : node.netbox
                                // The ranges are the one thing about a synced
                                // folder that is invisible until it is selected;
                                // hovering is the cheap way to peek at one.
                                ? [
                                    t('hostTree.netbox.managedTitle'),
                                    ...(node.netbox.prefixes ?? []),
                                ].join('\n')
                                : undefined
                    }
                    style={{ paddingLeft: `${depth * 14 + 8}px` }}
                    data-node-id={node.id}
                    tabIndex={node.type === 'host' ? 0 : undefined}
                    // Reordering is disabled while filtering: "before"/"after" is
                    // read off the visible order, which hides siblings here.
                    draggable={!isFiltering}
                    onDragStart={(e) => {
                        setDraggedNodeId(node.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', node.id);
                    }}
                    onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!draggedNodeId || draggedNodeId === node.id) return;
                        e.dataTransfer.dropEffect = 'move';

                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        const h = rect.height;

                        let position: 'before' | 'after' | 'inside';
                        const isNodeExpanded = expanded[node.id] ?? true;

                        if (node.type === 'folder') {
                            if (isNodeExpanded && node.children && node.children.length > 0) {
                                if (y < h * 0.25) position = 'before';
                                else position = 'inside';
                            } else {
                                if (y < h * 0.25) position = 'before';
                                else if (y > h * 0.75) position = 'after';
                                else position = 'inside';
                            }
                        } else {
                            position = y < h * 0.5 ? 'before' : 'after';
                        }
                        setDropTarget({ nodeId: node.id, position });
                    }}
                    onDragLeave={(e) => {
                        const related = e.relatedTarget as HTMLElement;
                        if (!e.currentTarget.contains(related)) {
                            if (dropTarget?.nodeId === node.id) setDropTarget(null);
                        }
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!draggedNodeId || draggedNodeId === node.id || !onMoveNode) {
                            setDraggedNodeId(null);
                            setDropTarget(null);
                            return;
                        }

                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        const h = rect.height;

                        let position: 'before' | 'after' | 'inside';
                        const isNodeExpanded = expanded[node.id] ?? true;

                        if (node.type === 'folder') {
                            if (isNodeExpanded && node.children && node.children.length > 0) {
                                if (y < h * 0.25) position = 'before';
                                else position = 'inside';
                            } else {
                                if (y < h * 0.25) position = 'before';
                                else if (y > h * 0.75) position = 'after';
                                else position = 'inside';
                            }
                        } else {
                            position = y < h * 0.5 ? 'before' : 'after';
                        }

                        onMoveNode(draggedNodeId, node.id, position);
                        setDraggedNodeId(null);
                        setDropTarget(null);
                    }}
                    onDragEnd={() => {
                        setDraggedNodeId(null);
                        setDropTarget(null);
                    }}
                    // A click only selects. Expanding a folder used to ride along
                    // here, which collapsed the tree under you whenever you picked
                    // a folder just to right-click it or to aim the + buttons.
                    onClick={() => {
                        onSelect(node);
                    }}
                    onDoubleClick={() => {
                        if (node.type === 'host') onDoubleClickHost?.(node);
                        else toggle(node.id);
                    }}
                    onContextMenu={(e) => openContextMenu(e, node)}
                    onKeyDown={(e) => {
                        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                            e.preventDefault();
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const containerRect = containerRef.current?.getBoundingClientRect();
                            const x = containerRect ? rect.left - containerRect.left : rect.left;
                            const y = containerRect ? rect.bottom - containerRect.top : rect.bottom;
                            setContextMenu({ x, y, node });
                        } else if (e.key === 'F2' && !isNetboxNamed(node)) {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingNodeId(node.id);
                            setEditingName(node.name);
                        }
                    }}
                >
                    {node.type === 'folder' ? (
                        <>
                            {/* Two quick clicks on the arrow are two toggles, so they
                                must land back where they started. Without stopping the
                                dblclick it would also reach the row and add a third. */}
                            <span
                                className="tree-icon tree-chevron-hit"
                                onClick={(e) => { e.stopPropagation(); if (hasChildren) toggle(node.id); }}
                                onDoubleClick={(e) => e.stopPropagation()}
                                style={{ opacity: hasChildren ? 1 : 0, cursor: hasChildren ? 'pointer' : 'default' }}
                            >
                                <svg
                                    className={`tree-chevron ${isExpanded ? 'expanded' : ''}`}
                                    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                                >
                                    <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                            </span>
                            <span className="tree-icon">{nodeIcon(node)}</span>
                        </>
                    ) : (
                        <>
                            <span className="tree-icon" style={{ opacity: 0 }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                            </span>
                            <span className="tree-icon">{nodeIcon(node)}</span>
                        </>
                    )}
                    <span className="tree-label">
                        {editingNodeId === node.id ? (
                            <input
                                autoFocus
                                type="text"
                                className="tree-label-edit-input"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onDoubleClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter') {
                                        if (editingName.trim() && editingName !== node.name && !isNetboxNamed(node)) {
                                            onEditNode(node.id, { name: editingName.trim() });
                                        }
                                        setEditingNodeId(null);
                                    } else if (e.key === 'Escape') {
                                        setEditingNodeId(null);
                                    }
                                }}
                                onBlur={() => {
                                    if (editingName.trim() && editingName !== node.name && !isNetboxNamed(node)) {
                                        onEditNode(node.id, { name: editingName.trim() });
                                    }
                                    setEditingNodeId(null);
                                }}
                            />
                        ) : (
                            <>
                                {node.name}
                                {node.netbox?.missing && (
                                    <span className="tree-meta tree-meta-missing">
                                        {' '}{t('hostTree.netbox.missing')}
                                    </span>
                                )}
                                {node.type === 'host' && node.entry && (
                                    <span className="tree-meta">
                                        {node.entry.protocol === 'gcloud-iap' ? (
                                            <>{' '}{node.entry.iapTunnel?.project}:{node.entry.iapTunnel?.instance} <span className="tree-meta-via">(IAP)</span></>
                                        ) : (
                                            <>
                                                {' '}{node.entry.host}
                                                {node.entry.jumpboxId && (() => {
                                                    const jb = flattenHosts(tree).find(n => n.id === node.entry!.jumpboxId);
                                                    return jb ? <span className="tree-meta-via"> via {jb.name}</span> : null;
                                                })()}
                                            </>
                                        )}
                                    </span>
                                )}
                            </>
                        )}
                    </span>
                </div>
                {node.type === 'folder' && isExpanded && node.children && (
                    <div className="host-tree-children">
                        {node.children.map(child => renderNode(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div
            className="host-tree-container"
            ref={containerRef}
            onContextMenu={(e) => openContextMenu(e, null)}
        >
            {/* Toolbar */}
            <div className="host-tree-toolbar">
                <div
                    className="tree-toolbar-btn"
                    role="button"
                    title={t('hostTree.toolbar.addFolder')}
                    onClick={() => openAddFolder(getTargetParentId())}
                    style={{ cursor: 'pointer' }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-folder)' }}>
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        <line x1="12" y1="11" x2="12" y2="17"></line>
                        <line x1="9" y1="14" x2="15" y2="14"></line>
                    </svg>
                </div>
                <div
                    className="tree-toolbar-btn"
                    role="button"
                    title={t('hostTree.toolbar.addHost')}
                    onClick={() => openAddHost(getTargetParentId())}
                    style={{ cursor: 'pointer' }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-host)' }}>
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                        <line x1="12" y1="6" x2="12" y2="14"></line>
                        <line x1="8" y1="10" x2="16" y2="10"></line>
                        <line x1="8" y1="21" x2="16" y2="21"></line>
                        <line x1="12" y1="17" x2="12" y2="21"></line>
                    </svg>
                </div>
                <div style={{ flex: 1 }} />
                {netboxConfigured && onNetboxSync && (
                    <div
                        className={`tree-toolbar-btn${netboxSyncing ? ' netbox-syncing' : ''}${netboxLastError ? ' netbox-error' : ''}`}
                        role="button"
                        title={
                            netboxLastError
                                ? `${t('hostTree.netbox.syncFailed')}: ${netboxLastError}`
                                : netboxSyncing
                                    ? t('hostTree.netbox.syncing')
                                    : t('hostTree.netbox.syncTitle')
                        }
                        onClick={() => { if (!netboxSyncing) onNetboxSync(); }}
                        style={{ cursor: netboxSyncing ? 'default' : 'pointer' }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-color)' }}>
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <polyline points="1 20 1 14 7 14"></polyline>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                        </svg>
                    </div>
                )}
                <div
                    className="tree-toolbar-btn"
                    role="button"
                    title={t('hostTree.toolbar.exportTree')}
                    onClick={() => handleExport(null)}
                    style={{ cursor: 'pointer' }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-danger)' }}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="17 8 12 3 7 8"></polyline>
                        <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                </div>
                <div
                    className="tree-toolbar-btn"
                    role="button"
                    title={t('hostTree.toolbar.importTree')}
                    onClick={() => handleImport(null)}
                    style={{ cursor: 'pointer' }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--success-color)' }}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                </div>
            </div>

            {/* Filter */}
            <div className="host-tree-filter">
                <input
                    ref={filterInputRef}
                    type="text"
                    className="host-tree-filter-input"
                    placeholder={t('hostTree.filter.placeholder')}
                    aria-label={t('hostTree.filter.ariaLabel')}
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    onKeyDown={(e) => {
                        // Both keys are claimed by SessionDialog's document-level
                        // handler (Enter connects, Escape closes the dialog), so
                        // every branch below must stop the event itself.
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            e.stopPropagation();
                            if (filterQuery) setFilterQuery('');
                            else filterInputRef.current?.blur();
                        } else if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            // Pick the first match and hand focus to its row —
                            // a second Enter there connects via the normal path.
                            if (firstVisibleHost) {
                                onSelect(firstVisibleHost);
                                focusRow(firstVisibleHost.id);
                            }
                        } else if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            e.stopPropagation();
                            if (firstVisibleHost) focusRow(firstVisibleHost.id);
                        }
                    }}
                />
                {filterQuery && (
                    <button
                        type="button"
                        className="host-tree-filter-clear"
                        title={t('hostTree.filter.clear')}
                        aria-label={t('hostTree.filter.clear')}
                        onClick={() => {
                            setFilterQuery('');
                            filterInputRef.current?.focus();
                        }}
                    >
                        {'×'}
                    </button>
                )}
            </div>

            {/* Tree */}
            <div className="host-tree-body">
                {onNewConnection && (
                    <div
                        className={`host-tree-row new-connection ${selectedId === null ? 'selected' : ''}`}
                        style={{ paddingLeft: '8px' }}
                        role="button"
                        tabIndex={0}
                        title={t('hostTree.newConnectionTitle')}
                        onClick={onNewConnection}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onNewConnection();
                            }
                        }}
                    >
                        <span className="tree-icon" style={{ opacity: 0 }} aria-hidden="true">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </span>
                        <span className="tree-icon" aria-hidden="true">{'\u{1F195}'}</span>
                        <span className="tree-label">{t('hostTree.newConnection')}</span>
                    </div>
                )}
                {tree.length === 0 && (
                    <div className="host-tree-empty">{t('hostTree.empty')}</div>
                )}
                {tree.length > 0 && isFiltering && visibleTree.length === 0 && (
                    <div className="host-tree-empty">
                        {t('hostTree.filter.noMatches', { query: filterQuery.trim() })}
                    </div>
                )}
                {visibleTree.map(node => renderNode(node, 0))}
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    ref={contextMenuRef}
                    className="context-menu"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {contextMenu.node?.type === 'folder' && onOpenAllInFolder && flattenHosts(contextMenu.node.children ?? []).length > 0 && (
                        <>
                            <button onClick={() => handleOpenAllClick(contextMenu.node!)}>
                                <span className="menu-icon-wrapper">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-color)' }}>
                                        <polyline points="13 17 18 12 13 7"></polyline>
                                        <polyline points="6 17 11 12 6 7"></polyline>
                                    </svg>
                                </span>
                                {t('hostTree.contextMenu.openAll')}
                            </button>
                            <div className="context-menu-separator" />
                        </>
                    )}
                    {contextMenu.node?.type !== 'host' && (
                        <>
                            <button onClick={() => openAddFolder(contextMenu.node?.id ?? null)}>
                                <span className="menu-icon-wrapper">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-folder)' }}>
                                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                        <line x1="12" y1="11" x2="12" y2="17"></line>
                                        <line x1="9" y1="14" x2="15" y2="14"></line>
                                    </svg>
                                </span>
                                {t('hostTree.contextMenu.addFolder')}
                            </button>
                            <button onClick={() => openAddHost(contextMenu.node?.id ?? null)}>
                                <span className="menu-icon-wrapper">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-host)' }}>
                                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                                        <line x1="12" y1="6" x2="12" y2="14"></line>
                                        <line x1="8" y1="10" x2="16" y2="10"></line>
                                        <line x1="8" y1="21" x2="16" y2="21"></line>
                                        <line x1="12" y1="17" x2="12" y2="21"></line>
                                    </svg>
                                </span>
                                {t('hostTree.contextMenu.addHost')}
                            </button>
                            {/* Right-click, not the toolbar: this action has a
                                scope ("the hosts under this folder"), and a
                                toolbar button has nowhere to say what it is.
                                The empty background is `node === null`, which
                                gives "the whole tree" for free. Hidden while
                                the setting is off — a menu item that does the
                                thing the user turned off is a contradiction. */}
                            {netboxPlacement && onApplyPlacements && prefixFolders.length > 0 && (
                                <button
                                    onClick={() => {
                                        setMoveByPrefixScope({ id: contextMenu.node?.id ?? null });
                                        setContextMenu(null);
                                    }}
                                >
                                    <span className="menu-icon-wrapper">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-folder)' }}>
                                            <line x1="3" y1="6" x2="21" y2="6"></line>
                                            <line x1="3" y1="12" x2="15" y2="12"></line>
                                            <line x1="3" y1="18" x2="9" y2="18"></line>
                                        </svg>
                                    </span>
                                    {t('hostTree.contextMenu.moveByPrefix')}
                                </button>
                            )}
                        </>
                    )}
                    {/* One host, one destination, named in the label. Reading
                        it before clicking IS the confirmation ADR-020 requires,
                        so the click moves straight away instead of opening the
                        bulk preview for a single row. */}
                    {hostPlacementItem && onApplyPlacements && contextMenu.node && (
                        <>
                            <button
                                disabled={hostPlacementItem.target === null}
                                title={
                                    hostPlacementItem.target
                                        ? formatPrefix(hostPlacementItem.target.prefix)
                                        : undefined
                                }
                                onClick={() => {
                                    const target = hostPlacementItem.target;
                                    const hostId = contextMenu.node?.id;
                                    if (!target || !hostId) return;
                                    const moved = onApplyPlacements([
                                        { hostId, targetFolderId: target.id },
                                    ]);
                                    setContextMenu(null);
                                    // Open the receiving folder, for the same
                                    // reason the bulk action does: a silent move
                                    // into a folded folder reads as nothing
                                    // having happened.
                                    setExpanded(prev => ({ ...prev, [target.id]: true }));
                                    onShowMessage?.(
                                        'success',
                                        t('dialogs.moveByPrefix.title'),
                                        t('dialogs.moveByPrefix.moved', { count: moved }),
                                    );
                                }}
                            >
                                <span className="menu-icon-wrapper">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-folder)' }}>
                                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                        <circle cx="12" cy="10" r="3"></circle>
                                    </svg>
                                </span>
                                {hostPlacementItem.label}
                            </button>
                            <div className="context-menu-separator" />
                        </>
                    )}
                    {contextMenu.node && (
                        <>
                            {contextMenu.node.type === 'folder' && <div className="context-menu-separator" />}
                            {contextMenu.node && !isNetboxNamed(contextMenu.node) && (
                                <button
                                    onClick={() => {
                                        setEditingNodeId(contextMenu.node!.id);
                                        setEditingName(contextMenu.node!.name);
                                        setContextMenu(null);
                                    }}
                                >
                                    <span className="menu-icon-wrapper">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-warning)' }}>
                                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                                        </svg>
                                    </span>
                                    {t('hostTree.contextMenu.rename')}
                                </button>
                            )}
                            <button
                                onClick={() => handleExport(contextMenu.node)}
                            >
                                <span className="menu-icon-wrapper">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-danger)' }}>
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="17 8 12 3 7 8"></polyline>
                                        <line x1="12" y1="3" x2="12" y2="15"></line>
                                    </svg>
                                </span>
                                {t('hostTree.contextMenu.export')}
                            </button>
                            {contextMenu.node?.type === 'folder' && (
                                <button
                                    onClick={() => handleImport(contextMenu.node!.id)}
                                >
                                    <span className="menu-icon-wrapper">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--success-color)' }}>
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                            <polyline points="7 10 12 15 17 10"></polyline>
                                            <line x1="12" y1="15" x2="12" y2="3"></line>
                                        </svg>
                                    </span>
                                    {t('hostTree.contextMenu.import')}
                                </button>
                            )}
                            {contextMenu.node.type === 'folder' && onSortFolder && (
                                <>
                                    <button
                                        onClick={() => {
                                            onSortFolder(contextMenu.node?.id ?? null);
                                            setContextMenu(null);
                                        }}
                                    >
                                        <span className="menu-icon-wrapper">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-host)' }}>
                                                <path d="M18 15l-6-6-6 6"></path>
                                            </svg>
                                        </span>
                                        {t('hostTree.contextMenu.sortAscending')}
                                    </button>
                                    <button
                                        onClick={() => {
                                            onSortFolder(contextMenu.node?.id ?? null, 'desc');
                                            setContextMenu(null);
                                        }}
                                    >
                                        <span className="menu-icon-wrapper">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--icon-host)' }}>
                                                <path d="M6 9l6 6 6-6"></path>
                                            </svg>
                                        </span>
                                        {t('hostTree.contextMenu.sortDescending')}
                                    </button>
                                </>
                            )}
                            <button
                                className="danger"
                                onClick={() => {
                                    openNodeToDelete(contextMenu.node!);
                                    setContextMenu(null);
                                }}
                            >
                                <span className="menu-icon-wrapper">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-danger)' }}>
                                        <polyline points="3 6 5 6 21 6"></polyline>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                        <line x1="10" y1="11" x2="10" y2="17"></line>
                                        <line x1="14" y1="11" x2="14" y2="17"></line>
                                    </svg>
                                </span>
                                {t('common.delete')}
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* Add/Edit/Export/Import Modal */}
            {editModalOpen && editModal && (
                <div className="host-edit-modal-overlay" onClick={closeEditModal} tabIndex={-1}>
                    <div
                        className="host-edit-modal"
                        ref={editModalRef}
                        onClick={(e) => e.stopPropagation()}
                        onContextMenu={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                closeEditModal();
                            }
                        }}
                    >
                        <h3>
                            {editModal.mode === 'folder' ? (editModal.existingNode ? t('hostTree.modal.renameFolder') : t('hostTree.modal.addFolder')) :
                                editModal.mode === 'host' ? (editModal.existingNode ? t('hostTree.modal.editHost') : t('hostTree.modal.addHost')) :
                                    editModal.mode === 'export' ? t('hostTree.modal.exportTitle') : t('hostTree.modal.importTitle')}
                        </h3>

                        {editModal.mode !== 'export' && editModal.mode !== 'import' && (
                            <div className="modal-form-group">
                                <label>{t('hostTree.modal.displayName')}</label>
                                <input
                                    ref={modalInputRef}
                                    autoFocus
                                    type="text"
                                    value={formName}
                                    onChange={e => setFormName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                />
                            </div>
                        )}

                        {(editModal.mode === 'export' || editModal.mode === 'import') && (
                            <div className="modal-form-group">
                                <label>
                                    {editModal.mode === 'export' ? t('hostTree.modal.setEncryptionPassword') : t('hostTree.modal.enterDecryptionPassword')}
                                </label>
                                <input
                                    ref={modalInputRef}
                                    autoFocus
                                    type="password"
                                    value={formPassword}
                                    onChange={e => setFormPassword(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                    autoComplete="new-password"
                                />
                                <p style={{ fontSize: 'calc(var(--font-size-base) - 4px)', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    {editModal.mode === 'export'
                                        ? t('hostTree.modal.exportPasswordHint')
                                        : t('hostTree.modal.importPasswordHint')}
                                </p>
                            </div>
                        )}

                        {editModal.mode === 'host' && (
                            <>
                                <div className="modal-form-group">
                                    <label>{t('hostTree.modal.protocol')}</label>
                                    <select
                                        value={formProtocol}
                                        onChange={e => {
                                            const p = e.target.value as 'ssh' | 'telnet';
                                            setFormProtocol(p);
                                            if (p === 'ssh') setFormPort('22');
                                            else if (p === 'telnet') setFormPort('23');
                                            if (p !== 'ssh') setFormIsJumpbox(false);
                                        }}
                                    >
                                        <option value="ssh">SSH</option>
                                        <option value="telnet">Telnet</option>
                                    </select>
                                </div>
                                {formProtocol === 'ssh' && (
                                    <div className="modal-form-group modal-form-group-checkbox">
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={formIsJumpbox}
                                                onChange={e => setFormIsJumpbox(e.target.checked)}
                                            />
                                            {t('hostTree.modal.useAsJumpbox')}
                                        </label>
                                    </div>
                                )}
                                {(formProtocol === 'ssh' || formProtocol === 'telnet') && (
                                    <>
                                        <div className="modal-form-row">
                                            <div className="modal-form-group flex-3">
                                                <label>{t('hostTree.modal.hostLabel')}</label>
                                                <input
                                                    type="text"
                                                    value={formHost}
                                                    onChange={e => setFormHost(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                    placeholder={t('hostTree.modal.hostPlaceholder')}
                                                />
                                            </div>
                                            <div className="modal-form-group flex-1">
                                                <label>{t('hostTree.modal.portLabel')}</label>
                                                <input
                                                    type="number"
                                                    value={formPort}
                                                    onChange={e => setFormPort(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                />
                                            </div>
                                        </div>
                                        {/* One row, and only when there is something to say.
                                            `noPrefixes` (the feature is not set up) and
                                            `notAnAddress` (a hostname was typed) render
                                            nothing at all, so the form keeps its old height
                                            for everyone who is not using this. */}
                                        {placement.kind === 'one' && (
                                            <div className="host-edit-netbox-hint">
                                                <span className="host-edit-netbox-matched">
                                                    {t('hostTree.netbox.placement.matched', {
                                                        prefix: formatPrefix(placement.folder.prefix),
                                                    })}
                                                </span>
                                                <div className="host-edit-netbox-choice">
                                                    <span className="host-edit-netbox-label">
                                                        {t('hostTree.netbox.placement.saveTo')}
                                                    </span>
                                                    <label>
                                                        <input
                                                            type="radio"
                                                            name="netbox-placement"
                                                            checked={useNetboxFolder ?? true}
                                                            onChange={() => setUseNetboxFolder(true)}
                                                        />
                                                        {placement.folder.name}
                                                    </label>
                                                    <label>
                                                        <input
                                                            type="radio"
                                                            name="netbox-placement"
                                                            checked={!(useNetboxFolder ?? true)}
                                                            onChange={() => setUseNetboxFolder(false)}
                                                        />
                                                        {t('hostTree.netbox.placement.here', {
                                                            name: currentParentName,
                                                        })}
                                                    </label>
                                                </div>
                                            </div>
                                        )}
                                        {placement.kind === 'ambiguous' && (
                                            <div className="host-edit-netbox-hint">
                                                {t('hostTree.netbox.placement.ambiguous', {
                                                    prefix: formatPrefix(placement.folders[0].prefix),
                                                    folders: placement.folders.map(f => f.name).join(', '),
                                                })}
                                            </div>
                                        )}
                                        {placement.kind === 'unmatched' && (
                                            <div className="host-edit-netbox-hint">
                                                {t('hostTree.netbox.placement.unmatched')}
                                            </div>
                                        )}
                                        <div className="modal-form-group">
                                            <label>{t('hostTree.modal.usernameLabel')}</label>
                                            <input
                                                type="text"
                                                value={formUsername}
                                                onChange={e => setFormUsername(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                autoComplete="off"
                                            />
                                        </div>
                                        <div className="modal-form-group">
                                            <label>{t('hostTree.modal.passwordLabel')}</label>
                                            <input
                                                type="password"
                                                value={formPassword}
                                                onChange={e => setFormPassword(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                autoComplete="new-password"
                                            />
                                        </div>
                                        <div className="modal-form-group">
                                            <label>{t('hostTree.modal.fixedTerminalSizeLabel')}</label>
                                            <select
                                                value={formFixedTerminalSize}
                                                onChange={e => setFormFixedTerminalSize(e.target.value as FixedSizeTri)}
                                            >
                                                <option value="default">{t('hostTree.modal.fixedTerminalSizeDefault')}</option>
                                                <option value="on">{t('hostTree.modal.fixedTerminalSizeOn')}</option>
                                                <option value="off">{t('hostTree.modal.fixedTerminalSizeOff')}</option>
                                            </select>
                                        </div>
                                    </>
                                )}
                            </>
                        )}

                        <div className="modal-actions">
                            <button className="btn-secondary" onClick={closeEditModal}>{t('common.cancel')}</button>
                            <button className="btn-primary" onClick={handleModalSubmit}>
                                {editModal.mode === 'export' ? t('hostTree.modal.export') :
                                    editModal.mode === 'import' ? t('hostTree.modal.import') : t('common.save')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {nodeToDeleteOpen && nodeToDelete && (() => {
                const jumpboxRefs = nodeToDelete.type === 'host' && nodeToDelete.entry?.isJumpbox
                    ? getJumpboxReferences(tree, nodeToDelete.id)
                    : [];
                const refWarning = jumpboxRefs.length > 0
                    ? t('hostTree.delete.jumpboxWarning', { count: jumpboxRefs.length, names: jumpboxRefs.map(r => r.name).join(', ') })
                    : '';
                // Deleting is allowed — the sync recreates the folder — but the
                // hosts the user put inside it do not come back.
                const netboxWarning = isNetboxNamed(nodeToDelete) ? t('hostTree.netbox.deleteWarning') : '';
                const warning = [refWarning, netboxWarning].filter(Boolean).join(' ');
                return (
                <ConfirmModal
                    title={nodeToDelete.type === 'folder' ? t('hostTree.delete.titleFolder') : t('hostTree.delete.titleHost')}
                    message={t('hostTree.delete.message', { name: nodeToDelete.name, warning })}
                    onConfirm={() => {
                        for (const ref of jumpboxRefs) {
                            onEditNode(ref.id, { entry: { ...ref.entry!, jumpboxId: undefined } });
                        }
                        onDeleteNode(nodeToDelete.id);
                        closeNodeToDelete();
                    }}
                    onCancel={() => {
                        closeNodeToDelete();
                    }}
                />
                );
            })()}

            {openAllConfirmOpen && openAllNode && (
                <ConfirmModal
                    title={t('hostTree.openAll.confirmTitle')}
                    message={t('hostTree.openAll.confirmMessage', { count: flattenHosts(openAllNode.children ?? []).length, name: openAllNode.name })}
                    confirmLabel={t('hostTree.contextMenu.openAll')}
                    onConfirm={() => {
                        onOpenAllInFolder?.(openAllNode);
                        closeOpenAllConfirm();
                    }}
                    onCancel={closeOpenAllConfirm}
                />
            )}

            {moveByPrefixScope && onApplyPlacements && (
                <MoveByPrefixModal
                    tree={tree}
                    scopeFolderId={moveByPrefixScope.id}
                    onClose={() => setMoveByPrefixScope(null)}
                    onApply={(moves) => {
                        const moved = onApplyPlacements(moves);
                        setMoveByPrefixScope(null);
                        // Open every folder that received something, for the
                        // same reason the add form does: the NetBox subtree is
                        // collapsed on every open, and a silent move into a
                        // folded folder reads as nothing having happened.
                        setExpanded(prev => {
                            const next = { ...prev };
                            for (const m of moves) next[m.targetFolderId] = true;
                            return next;
                        });
                        onShowMessage?.(
                            'success',
                            t('dialogs.moveByPrefix.title'),
                            t('dialogs.moveByPrefix.moved', { count: moved }),
                        );
                    }}
                />
            )}
        </div>
    );
};
