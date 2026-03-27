import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import type { HostTreeNode, HostEntry } from '../../hooks/useHostManager';
import { flattenHosts, getJumpboxReferences } from '../../hooks/useHostManager';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useModalState } from '../../hooks/useModalState';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import * as electronService from '../../services/electronService';
import './HostTree.css';

interface ContextMenuState {
    x: number;
    y: number;
    node: HostTreeNode | null;
}

interface EditModalState {
    mode: 'folder' | 'host' | 'export' | 'import';
    parentId: string | null;
    existingNode?: HostTreeNode;
}

interface HostTreeProps {
    tree: HostTreeNode[];
    selectedId: string | null;
    onSelect: (node: HostTreeNode) => void;
    onDoubleClickHost?: (node: HostTreeNode) => void;
    onAddFolder: (parentId: string | null, name: string) => void;
    onAddHost: (parentId: string | null, name: string, entry: HostEntry) => void;
    onEditNode: (id: string, patch: Partial<HostTreeNode>) => void;
    onDeleteNode: (id: string) => void;
    onMoveNode?: (nodeId: string, targetId: string, position: 'before' | 'after' | 'inside') => void;
    onSortFolder?: (folderId: string | null) => void;
    onImportData?: (nodes: HostTreeNode[], folderName: string, parentId: string | null) => Promise<string | undefined> | void;
    onShowMessage?: (type: 'error' | 'success' | 'info', title: string | undefined, message: string) => void;
}

export const HostTree: React.FC<HostTreeProps> = ({
    tree,
    selectedId,
    onSelect,
    onDoubleClickHost,
    onAddFolder,
    onAddHost,
    onEditNode,
    onDeleteNode,
    onMoveNode,
    onSortFolder,
    onImportData,
    onShowMessage
}) => {
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [exportNode, setExportNode] = useState<HostTreeNode | null>(null);
    const [editModalOpen, openEditModal, closeEditModal, editModal] = useModalState<EditModalState>();
    const [nodeToDeleteOpen, openNodeToDelete, closeNodeToDelete, nodeToDelete] = useModalState<HostTreeNode>();

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
    const [formIapEnabled, setFormIapEnabled] = useState(false);
    const [formIapProject, setFormIapProject] = useState('');
    const [formIapZone, setFormIapZone] = useState('');
    const [formIapInstance, setFormIapInstance] = useState('');
    // IAP autocomplete state
    const [iapGcloudStatus, setIapGcloudStatus] = useState<{ available: boolean; version?: string } | null>(null);
    const [iapAuthStatus, setIapAuthStatus] = useState<{ authenticated: boolean; account?: string } | null>(null);
    const [iapCheckingGcloud, setIapCheckingGcloud] = useState(false);
    const [iapCheckingAuth, setIapCheckingAuth] = useState(false);
    const [iapProjects, setIapProjects] = useState<{ id: string; name: string }[]>([]);
    const [iapZones, setIapZones] = useState<string[]>([]);
    const [iapInstances, setIapInstances] = useState<{ name: string; status: string }[]>([]);
    const [iapLoadingProjects, setIapLoadingProjects] = useState(false);
    const [iapLoadingZones, setIapLoadingZones] = useState(false);
    const [iapLoadingInstances, setIapLoadingInstances] = useState(false);
    const iapLoadingFromEditRef = useRef(false);
    const [importFilePath, setImportFilePath] = useState<string | null>(null);
    const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<{ nodeId: string; position: 'before' | 'after' | 'inside' } | null>(null);
    const modalInputRef = useRef<HTMLInputElement>(null);

    const focusModal = useCallback(() => {
        setTimeout(() => {
            if (modalInputRef.current) {
                modalInputRef.current.focus();
                // Ensure the window itself has focus (critical after native alerts in Electron)
                try {
                    electronService.focusWindow();
                    window.focus();
                } catch { /* focus best-effort */ }
            }
        }, 200);
    }, []);

    const containerRef = useRef<HTMLDivElement>(null);
    const editModalRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);

    // Focus trap for the edit modal
    useFocusTrap(editModalRef, editModalOpen);

    useEffect(() => {
        const handler = () => setContextMenu(null);
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, []);

    // Handle focus when modal opens
    useEffect(() => {
        if (editModalOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setEditingNodeId(null);
            focusModal();
        }
    }, [editModalOpen, focusModal]);

    // IAP: check gcloud and auth when IAP is enabled in the modal
    /* eslint-disable react-hooks/set-state-in-effect */
    useEffect(() => {
        if (!formIapEnabled) {
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
            const gcloud = await electronService.gceIapCheckGcloud();
            if (cancelled) return;
            setIapGcloudStatus(gcloud);
            setIapCheckingGcloud(false);
            if (gcloud.available) {
                setIapCheckingAuth(true);
                const auth = await electronService.gceIapCheckAuth();
                if (cancelled) return;
                setIapAuthStatus(auth);
                setIapCheckingAuth(false);
            }
        })();
        return () => { cancelled = true; };
    }, [formIapEnabled]);

    // IAP: auto-load projects when auth succeeds
    useEffect(() => {
        if (iapAuthStatus?.authenticated && iapProjects.length === 0 && !iapLoadingProjects) {
            setIapLoadingProjects(true);
            electronService.gceIapListProjects().then(projects => {
                setIapProjects(projects);
                setIapLoadingProjects(false);
            });
        }
    }, [iapAuthStatus?.authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

    // IAP: reset dependent fields and auto-load zones when project changes
    useEffect(() => {
        if (iapLoadingFromEditRef.current) return;
        setIapZones([]);
        setIapInstances([]);
        if (formIapProject) {
            setIapLoadingZones(true);
            electronService.gceIapListZones(formIapProject).then(zones => {
                setIapZones(zones);
                setIapLoadingZones(false);
            });
        }
    }, [formIapProject]);

    // IAP: reset instances and auto-load when zone changes
    useEffect(() => {
        if (iapLoadingFromEditRef.current) return;
        setIapInstances([]);
        if (formIapZone && formIapProject) {
            setIapLoadingInstances(true);
            electronService.gceIapListInstances(formIapProject, formIapZone).then(instances => {
                setIapInstances(instances);
                setIapLoadingInstances(false);
            });
        }
    }, [formIapZone]); // eslint-disable-line react-hooks/exhaustive-deps
    /* eslint-enable react-hooks/set-state-in-effect */

    const toggle = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

    const openContextMenu = useCallback((e: React.MouseEvent, node: HostTreeNode | null) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, node });
    }, []);

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
        setFormIapEnabled(false);
        setFormIapProject('');
        setFormIapZone('');
        setFormIapInstance('');
        openEditModal({ mode: 'host', parentId });
        setContextMenu(null);
    }, [openEditModal]);


    const handleExport = (node: HostTreeNode | null = null) => {
        setExportNode(node);
        setFormName('');
        setFormPassword('');
        openEditModal({ mode: 'export', parentId: null });
        setContextMenu(null);
        electronService.logDebug(`Export modal opened${node ? ` for node: ${node.name}` : ' for full tree'}`);
    };

    const handleImport = async (parentId: string | null = null) => {
        electronService.logDebug(`Import button clicked${parentId ? ` for parent: ${parentId}` : ''}`);
        try {
            const filePath = await electronService.selectImportFile();
            if (!filePath) {
                electronService.logDebug('Import file selection cancelled');
                return;
            }
            setImportFilePath(filePath);
            setFormPassword('');
            openEditModal({ mode: 'import', parentId });
            setContextMenu(null);
            electronService.logDebug('Import password modal opened');
        } catch (err: unknown) {
            onShowMessage?.('error', 'Import Error', 'Failed to open file: ' + (err instanceof Error ? err.message : String(err)));
        }
    };



    const handleModalSubmit = async () => {
        if (!editModal) return;
        const { mode, parentId, existingNode } = editModal;

        if (mode === 'export') {
            if (!formPassword) return;
            try {
                electronService.logDebug('Calling exportHTree IPC from modal');
                // Use selected node or full tree
                const dataToExport = exportNode ? [exportNode] : tree;
                const success = await electronService.exportHTree(dataToExport, formPassword);

                // Close modal and reset state BEFORE showing success alert
                closeEditModal();
                setExportNode(null);
                setFormPassword('');

                if (success) {
                    setTimeout(() => {
                        onShowMessage?.('success', 'Export Successful', 'Host tree has been exported successfully.');
                        focusModal();
                    }, 50);
                }
            } catch (err: unknown) {
                onShowMessage?.('error', 'Export Failed', err instanceof Error ? err.message : String(err));
            }
            return;
        }

        if (mode === 'import') {
            if (!formPassword || !importFilePath) return;
            try {
                electronService.logDebug('Calling decryptImportFile IPC from modal');
                const data = await electronService.decryptImportFile(formPassword);
                if (data && onImportData) {
                    // Extract filename from path for folder naming
                    const pathParts = importFilePath.split(/[\\/]/);
                    const fileNameWithExt = pathParts[pathParts.length - 1];
                    const fileName = fileNameWithExt.replace(/\.[^/.]+$/, "");

                    const currentParentId = parentId;
                    const folderId = await onImportData(data as HostTreeNode[], currentParentId ? '' : `Imported_${fileName}`, currentParentId);

                    // Auto-expand the target folder
                    if (folderId) {
                        setExpanded(prev => ({ ...prev, [folderId]: true }));
                    }

                    // Close modal and reset state BEFORE showing success alert
                    closeEditModal();
                    setImportFilePath(null);
                    setFormPassword('');

                    setTimeout(() => {
                        onShowMessage?.('success', 'Import Successful', currentParentId ? 'Hosts imported successfully.' : `Hosts imported and added to "Imported_${fileName}" folder.`);
                        focusModal();
                    }, 50);
                }
            } catch (err: unknown) {
                onShowMessage?.('error', 'Import Failed', err instanceof Error ? err.message : String(err));
                // Keep password if failed, but maybe good to clear on some errors?
                // Let's keep it for now so user can try again.
            }
            return;
        }

        if (existingNode) {
            if (mode === 'folder') {
                onEditNode(existingNode.id, { name: formName });
            } else {
                const entry: HostEntry = {
                    protocol: formProtocol,
                    host: formIapEnabled ? formIapInstance : formHost,
                    port: parseInt(formPort),
                    username: formUsername || undefined,
                    password: formPassword || undefined,
                    isJumpbox: formProtocol === 'ssh' ? (formIsJumpbox || undefined) : undefined,
                    jumpboxId: formIapEnabled ? undefined : existingNode.entry?.jumpboxId,
                    iapTunnel: formIapEnabled ? { project: formIapProject, zone: formIapZone, instance: formIapInstance } : undefined,
                };
                onEditNode(existingNode.id, { name: formName, entry });
            }
        } else {
            if (mode === 'folder') {
                onAddFolder(parentId, formName);
            } else {
                const entry: HostEntry = {
                    protocol: formProtocol,
                    host: formIapEnabled ? formIapInstance : formHost,
                    port: parseInt(formPort),
                    username: formUsername || undefined,
                    password: formPassword || undefined,
                    isJumpbox: formProtocol === 'ssh' ? (formIsJumpbox || undefined) : undefined,
                    iapTunnel: formIapEnabled ? { project: formIapProject, zone: formIapZone, instance: formIapInstance } : undefined,
                };
                onAddHost(parentId, formName, entry);
            }
        }
        closeEditModal();
    };

    const renderNode = (node: HostTreeNode, depth: number): React.ReactNode => {
        const isExpanded = expanded[node.id] ?? true;
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
                    className={`host-tree-row ${isSelected ? 'selected' : ''} ${dragClasses}`}
                    style={{ paddingLeft: `${depth * 14 + 8}px` }}
                    tabIndex={node.type === 'host' ? 0 : undefined}
                    draggable
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
                            // If folder is expanded and has children, dropping at the bottom of the header means 'inside' 
                            // rather than 'after' (since children are in between).
                            if (isNodeExpanded && node.children && node.children.length > 0) {
                                if (y < h * 0.25) position = 'before';
                                else position = 'inside';
                            } else {
                                if (y < h * 0.25) position = 'before';
                                else if (y > h * 0.75) position = 'after';
                                else position = 'inside';
                            }
                        } else {
                            // Host: top 50% = before, bottom 50% = after
                            position = y < h * 0.5 ? 'before' : 'after';
                        }
                        setDropTarget({ nodeId: node.id, position });
                    }}
                    onDragLeave={(e) => {
                        // Only clear if leaving the element entirely
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

                        // Calculate drop position synchronously to avoid React state closure staleness
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
                    onClick={() => {
                        onSelect(node);
                        if (node.type === 'folder') toggle(node.id);
                    }}
                    onDoubleClick={() => {
                        if (node.type === 'host') onDoubleClickHost?.(node);
                    }}
                    onContextMenu={(e) => openContextMenu(e, node)}
                    onKeyDown={(e) => {
                        // Application key or Shift+F10 → open context menu at element
                        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                            e.preventDefault();
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const containerRect = containerRef.current?.getBoundingClientRect();
                            const x = containerRect ? rect.left - containerRect.left : rect.left;
                            const y = containerRect ? rect.bottom - containerRect.top : rect.bottom;
                            setContextMenu({ x, y, node });
                        } else if (e.key === 'F2') {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingNodeId(node.id);
                            setEditingName(node.name);
                        }
                    }}
                >
                    {node.type === 'folder' ? (
                        <>
                            <span
                                className="tree-icon"
                                onClick={(e) => { e.stopPropagation(); toggle(node.id); }}
                                style={{ opacity: (!node.children || node.children.length === 0) ? 0 : 1, cursor: (!node.children || node.children.length === 0) ? 'default' : 'pointer' }}
                            >
                                <svg
                                    className={`tree-chevron ${isExpanded ? 'expanded' : ''}`}
                                    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                                >
                                    <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                            </span>
                            <span className="tree-icon">📁</span>
                        </>
                    ) : (
                        <>
                            <span className="tree-icon" style={{ opacity: 0 }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                            </span>
                            <span className="tree-icon">{node.entry?.isJumpbox ? '🔗' : '🖥'}</span>
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
                                    e.stopPropagation(); // prevent tree row from handling it
                                    if (e.key === 'Enter') {
                                        if (editingName.trim() && editingName !== node.name) {
                                            onEditNode(node.id, { name: editingName.trim() });
                                        }
                                        setEditingNodeId(null);
                                    } else if (e.key === 'Escape') {
                                        setEditingNodeId(null);
                                    }
                                }}
                                onBlur={() => {
                                    if (editingName.trim() && editingName !== node.name) {
                                        onEditNode(node.id, { name: editingName.trim() });
                                    }
                                    setEditingNodeId(null);
                                }}
                            />
                        ) : (
                            <>
                                {node.name}
                                {node.type === 'host' && node.entry && (
                                    <span className="tree-meta">
                                        {node.entry.iapTunnel ? (
                                            <>{' '}{node.entry.iapTunnel.project}:{node.entry.iapTunnel.instance} <span className="tree-meta-via">(IAP)</span></>
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
                    title="Add Folder"
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
                    title="Add Host"
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
                <div
                    className="tree-toolbar-btn"
                    role="button"
                    title="Export Tree"
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
                    title="Import Tree"
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

            {/* Tree */}
            <div className="host-tree-body">
                {tree.length === 0 && (
                    <div className="host-tree-empty">Right-click or use the + buttons above to add hosts and folders</div>
                )}
                {tree.map(node => renderNode(node, 0))}
            </div>

            {/* Context Menu — position: fixed for top-level overlay */}
            {contextMenu && (
                <div
                    ref={contextMenuRef}
                    className="context-menu"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
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
                                Add Folder
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
                                Add Host
                            </button>
                        </>
                    )}
                    {contextMenu.node && (
                        <>
                            {contextMenu.node.type === 'folder' && <div className="context-menu-separator" />}
                            {contextMenu.node && (
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
                                    Rename (F2)
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
                                Export
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
                                    Import
                                </button>
                            )}
                            {contextMenu.node.type === 'folder' && onSortFolder && (
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
                                    Sort Ascending
                                </button>
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
                                Delete
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
                            {editModal.mode === 'folder' ? (editModal.existingNode ? 'Rename Folder' : 'Add Folder') :
                                editModal.mode === 'host' ? (editModal.existingNode ? 'Edit Host' : 'Add Host') :
                                    editModal.mode === 'export' ? 'Export Host Tree' : 'Import Host Tree'}
                        </h3>

                        {editModal.mode !== 'export' && editModal.mode !== 'import' && (
                            <div className="modal-form-group">
                                <label>Display Name</label>
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
                                    {editModal.mode === 'export' ? 'Set encryption password:' : 'Enter decryption password:'}
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
                                        ? 'This password will be required to import the file later.'
                                        : 'Enter the password that was used to export this file.'}
                                </p>
                            </div>
                        )}

                        {editModal.mode === 'host' && (
                            <>
                                <div className="modal-form-group">
                                    <label>Protocol</label>
                                    <select
                                        value={formProtocol}
                                        onChange={e => {
                                            const p = e.target.value as 'ssh' | 'telnet';
                                            setFormProtocol(p);
                                            setFormPort(p === 'ssh' ? '22' : '23');
                                            if (p !== 'ssh') setFormIsJumpbox(false);
                                        }}
                                    >
                                        <option value="ssh">SSH</option>
                                        <option value="telnet">Telnet</option>
                                    </select>
                                </div>
                                <div className="modal-form-group modal-form-group-checkbox">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={formIsJumpbox}
                                            onChange={e => setFormIsJumpbox(e.target.checked)}
                                            disabled={formProtocol !== 'ssh' || formIapEnabled}
                                        />
                                        Use as Jumpbox
                                    </label>
                                </div>
                                {formProtocol === 'ssh' && (
                                    <div className="modal-form-group modal-form-group-checkbox">
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={formIapEnabled}
                                                onChange={e => {
                                                    setFormIapEnabled(e.target.checked);
                                                    if (e.target.checked) setFormIsJumpbox(false);
                                                }}
                                            />
                                            Connect via Google Cloud IAP
                                        </label>
                                    </div>
                                )}
                                {formProtocol === 'ssh' && formIapEnabled && (
                                    <>
                                        {/* Auth status */}
                                        <div className="modal-form-group">
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
                                                        onClick={(e) => { e.preventDefault(); electronService.openExternal('https://cloud.google.com/sdk/docs/install'); }}
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
                                        <div className="modal-form-group">
                                            <label>GCP Project{iapLoadingProjects && <span style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}> (loading...)</span>}</label>
                                            {iapProjects.length > 0 ? (
                                                <select value={formIapProject} onChange={e => setFormIapProject(e.target.value)}>
                                                    <option value="">Select a project</option>
                                                    {iapProjects.map(p => (
                                                        <option key={p.id} value={p.id}>{p.name !== p.id ? `${p.name} (${p.id})` : p.id}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={formIapProject}
                                                    onChange={e => setFormIapProject(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                    placeholder="my-project-id"
                                                />
                                            )}
                                        </div>
                                        <div className="modal-form-group">
                                            <label>Zone{iapLoadingZones && <span style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}> (loading...)</span>}</label>
                                            {iapZones.length > 0 ? (
                                                <select value={formIapZone} onChange={e => setFormIapZone(e.target.value)}>
                                                    <option value="">Select a zone</option>
                                                    {iapZones.map(z => (
                                                        <option key={z} value={z}>{z}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={formIapZone}
                                                    onChange={e => setFormIapZone(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                    placeholder="us-central1-a"
                                                />
                                            )}
                                        </div>
                                        <div className="modal-form-group">
                                            <label>Instance{iapLoadingInstances && <span style={{ color: 'var(--text-tertiary)', fontWeight: 'normal' }}> (loading...)</span>}</label>
                                            {iapInstances.length > 0 ? (
                                                <select value={formIapInstance} onChange={e => setFormIapInstance(e.target.value)}>
                                                    <option value="">Select an instance</option>
                                                    {iapInstances.map(i => (
                                                        <option key={i.name} value={i.name}>{`${i.name} (${i.status})`}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={formIapInstance}
                                                    onChange={e => setFormIapInstance(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                    placeholder="my-instance"
                                                />
                                            )}
                                        </div>
                                    </>
                                )}
                                {!formIapEnabled && (
                                    <div className="modal-form-row">
                                        <div className="modal-form-group flex-3">
                                            <label>Host/IP</label>
                                            <input
                                                type="text"
                                                value={formHost}
                                                onChange={e => setFormHost(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                placeholder="192.168.1.1"
                                            />
                                        </div>
                                        <div className="modal-form-group flex-1">
                                            <label>Port</label>
                                            <input
                                                type="number"
                                                value={formPort}
                                                onChange={e => setFormPort(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                            />
                                        </div>
                                    </div>
                                )}
                                {(formProtocol === 'ssh' || formProtocol === 'telnet') && (
                                    <>
                                        <div className="modal-form-group">
                                            <label>Username</label>
                                            <input
                                                type="text"
                                                value={formUsername}
                                                onChange={e => setFormUsername(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                autoComplete="off"
                                            />
                                        </div>
                                        <div className="modal-form-group">
                                            <label>Password</label>
                                            <input
                                                type="password"
                                                value={formPassword}
                                                onChange={e => setFormPassword(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                                                autoComplete="new-password"
                                            />
                                        </div>
                                    </>
                                )}
                            </>
                        )}

                        <div className="modal-actions">
                            <button className="btn-secondary" onClick={closeEditModal}>Cancel</button>
                            <button className="btn-primary" onClick={handleModalSubmit}>
                                {editModal.mode === 'export' ? 'Export' :
                                    editModal.mode === 'import' ? 'Import' : 'Save'}
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
                    ? `\n\nThis host is used as a jumpbox by ${jumpboxRefs.length} host(s): ${jumpboxRefs.map(r => r.name).join(', ')}. Their jumpbox setting will be cleared.`
                    : '';
                return (
                <ConfirmModal
                    title={`Delete ${nodeToDelete.type === 'folder' ? 'Folder' : 'Host'}`}
                    message={`Are you sure you want to delete "${nodeToDelete.name}"?\nThis action cannot be undone.${refWarning}`}
                    onConfirm={() => {
                        // Clear jumpboxId from hosts referencing this jumpbox
                        for (const ref of jumpboxRefs) {
                            onEditNode(ref.id, { entry: { ...ref.entry!, jumpboxId: undefined } });
                        }
                        onDeleteNode(nodeToDelete.id);
                        closeNodeToDelete();
                        // Ensure window focus is restored after dialog closes (just in case)
                        setTimeout(() => {
                            try {
                                electronService.focusWindow();
                            } catch { /* focus best-effort */ }
                        }, 50);
                    }}
                    onCancel={() => {
                        closeNodeToDelete();
                        setTimeout(() => {
                            try {
                                electronService.focusWindow();
                            } catch { /* focus best-effort */ }
                        }, 50);
                    }}
                />
                );
            })()}
        </div>
    );
};
