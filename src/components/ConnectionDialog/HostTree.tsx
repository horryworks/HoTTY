import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { HostTreeNode, HostEntry } from '../../hooks/useHostManager';
import './HostTree.css';

interface ContextMenuState {
    x: number;
    y: number;
    node: HostTreeNode | null;
}

interface EditModalState {
    mode: 'folder' | 'host';
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
}) => {
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [editModal, setEditModal] = useState<EditModalState | null>(null);

    const [formName, setFormName] = useState('');
    const [formProtocol, setFormProtocol] = useState<'ssh' | 'telnet'>('ssh');
    const [formHost, setFormHost] = useState('');
    const [formPort, setFormPort] = useState('22');
    const [formUsername, setFormUsername] = useState('');
    const [formPassword, setFormPassword] = useState('');

    const containerRef = useRef<HTMLDivElement>(null);

    // Close context menu on outside click
    useEffect(() => {
        const handler = () => setContextMenu(null);
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, []);

    const toggle = (id: string) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

    const openContextMenu = useCallback((e: React.MouseEvent, node: HostTreeNode | null) => {
        e.preventDefault();
        e.stopPropagation();
        // Compute position relative to the container to avoid transform-parent issue
        const rect = containerRef.current?.getBoundingClientRect();
        const x = rect ? e.clientX - rect.left : e.clientX;
        const y = rect ? e.clientY - rect.top : e.clientY;
        setContextMenu({ x, y, node });
    }, []);

    const openAddFolder = useCallback((parentId: string | null) => {
        setFormName('');
        setEditModal({ mode: 'folder', parentId });
        setContextMenu(null);
    }, []);

    const openAddHost = useCallback((parentId: string | null) => {
        setFormName('');
        setFormProtocol('ssh');
        setFormHost('');
        setFormPort('22');
        setFormUsername('');
        setFormPassword('');
        setEditModal({ mode: 'host', parentId });
        setContextMenu(null);
    }, []);

    const openEditNode = useCallback((node: HostTreeNode) => {
        setFormName(node.name);
        if (node.type === 'host' && node.entry) {
            setFormProtocol(node.entry.protocol);
            setFormHost(node.entry.host);
            setFormPort(String(node.entry.port));
            setFormUsername(node.entry.username ?? '');
            setFormPassword(node.entry.password ?? '');
            setEditModal({ mode: 'host', parentId: null, existingNode: node });
        } else {
            setEditModal({ mode: 'folder', parentId: null, existingNode: node });
        }
        setContextMenu(null);
    }, []);

    const handleModalSubmit = () => {
        if (!editModal) return;
        const { mode, parentId, existingNode } = editModal;

        if (existingNode) {
            if (mode === 'folder') {
                onEditNode(existingNode.id, { name: formName });
            } else {
                const entry: HostEntry = {
                    protocol: formProtocol,
                    host: formHost,
                    port: parseInt(formPort),
                    username: formUsername || undefined,
                    password: formPassword || undefined,
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
                    port: parseInt(formPort),
                    username: formUsername || undefined,
                    password: formPassword || undefined,
                };
                onAddHost(parentId, formName, entry);
            }
        }
        setEditModal(null);
    };

    const renderNode = (node: HostTreeNode, depth: number): React.ReactNode => {
        const isExpanded = expanded[node.id] ?? true;
        const isSelected = selectedId === node.id;

        return (
            <div key={node.id} className="host-tree-node" style={{ paddingLeft: `${depth * 14}px` }}>
                <div
                    className={`host-tree-row ${isSelected ? 'selected' : ''}`}
                    tabIndex={node.type === 'host' ? 0 : undefined}
                    onClick={() => {
                        if (node.type === 'folder') toggle(node.id);
                        else onSelect(node);
                    }}
                    onDoubleClick={() => {
                        if (node.type === 'host') onDoubleClickHost?.(node);
                    }}
                    onContextMenu={(e) => openContextMenu(e, node)}
                >
                    {node.type === 'folder' ? (
                        <>
                            <span className="tree-icon">{isExpanded ? '▾' : '▸'}</span>
                            <span className="tree-icon">📁</span>
                        </>
                    ) : (
                        <>
                            <span className="tree-icon" style={{ opacity: 0 }}>▸</span>
                            <span className="tree-icon">🖥</span>
                        </>
                    )}
                    <span className="tree-label">
                        {node.name}
                        {node.type === 'host' && node.entry && (
                            <span className="tree-meta"> {node.entry.host}</span>
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
                    title="Add Root Folder"
                    onClick={() => openAddFolder(null)}
                    style={{ cursor: 'pointer' }}
                >📁+</div>
                <div
                    className="tree-toolbar-btn"
                    role="button"
                    title="Add Root Host"
                    onClick={() => openAddHost(null)}
                    style={{ cursor: 'pointer' }}
                >🖥+</div>
            </div>

            {/* Tree */}
            <div className="host-tree-body">
                {tree.length === 0 && (
                    <div className="host-tree-empty">Right-click or use the + buttons above to add hosts and folders</div>
                )}
                {tree.map(node => renderNode(node, 0))}
            </div>

            {/* Context Menu — position absolute relative to container to avoid transform-parent issue */}
            {contextMenu && (
                <div
                    className="context-menu"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {contextMenu.node?.type !== 'host' && (
                        <>
                            <button onClick={() => openAddFolder(contextMenu.node?.id ?? null)}>
                                📁 Add Folder
                            </button>
                            <button onClick={() => openAddHost(contextMenu.node?.id ?? null)}>
                                🖥 Add Host
                            </button>
                        </>
                    )}
                    {contextMenu.node && (
                        <>
                            <div className="context-menu-separator" />
                            <button onClick={() => openEditNode(contextMenu.node!)}>
                                ✏️ Edit
                            </button>
                            <button
                                className="danger"
                                onClick={() => {
                                    onDeleteNode(contextMenu.node!.id);
                                    setContextMenu(null);
                                }}
                            >
                                🗑 Delete
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* Add/Edit Modal */}
            {editModal && (
                <div className="host-edit-modal-overlay" onClick={() => setEditModal(null)}>
                    <div className="host-edit-modal" onClick={e => e.stopPropagation()}>
                        <h3 style={{ marginTop: 0 }}>
                            {editModal.existingNode ? 'Edit' : editModal.mode === 'folder' ? 'Add Folder' : 'Add Host'}
                        </h3>

                        <div className="modal-form-group">
                            <label>Display Name</label>
                            <input
                                autoFocus
                                type="text"
                                value={formName}
                                onChange={e => setFormName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleModalSubmit()}
                            />
                        </div>

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
                                        }}
                                    >
                                        <option value="ssh">SSH</option>
                                        <option value="telnet">Telnet</option>
                                    </select>
                                </div>
                                <div className="modal-form-row">
                                    <div className="modal-form-group flex-3">
                                        <label>Host / IP</label>
                                        <input
                                            type="text"
                                            value={formHost}
                                            onChange={e => setFormHost(e.target.value)}
                                            placeholder="192.168.1.1"
                                        />
                                    </div>
                                    <div className="modal-form-group flex-1">
                                        <label>Port</label>
                                        <input
                                            type="number"
                                            value={formPort}
                                            onChange={e => setFormPort(e.target.value)}
                                        />
                                    </div>
                                </div>
                                {formProtocol === 'ssh' && (
                                    <>
                                        <div className="modal-form-group">
                                            <label>Username</label>
                                            <input
                                                type="text"
                                                value={formUsername}
                                                onChange={e => setFormUsername(e.target.value)}
                                            />
                                        </div>
                                        <div className="modal-form-group">
                                            <label>Password</label>
                                            <input
                                                type="password"
                                                value={formPassword}
                                                onChange={e => setFormPassword(e.target.value)}
                                            />
                                        </div>
                                    </>
                                )}
                            </>
                        )}

                        <div className="modal-actions">
                            <button className="btn-secondary" onClick={() => setEditModal(null)}>Cancel</button>
                            <button className="btn-primary" onClick={handleModalSubmit}>Save</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
