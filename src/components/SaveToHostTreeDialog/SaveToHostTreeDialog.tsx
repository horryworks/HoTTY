import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../Dialog/Dialog';
import { useHostManager } from '../../hooks/useHostManager';
import { buildHostEntryFromConfig } from './buildHostEntry';
import { useSettingsStore } from '../../stores/settingsStore';
import { collectPrefixFolders, suggestFolderForHost, type PlacementResult } from '../../utils/netboxPlacement';
import { formatPrefix } from '../../utils/cidr';
import type { HostTreeNode, ProtocolId } from '../../types/appTypes';
import type { AnyConfig } from '../../hooks/useSessionManager';
import './SaveToHostTreeDialog.css';

interface SaveToHostTreeDialogProps {
    open: boolean;
    initialName: string;
    protocol: ProtocolId | null;
    config: AnyConfig | undefined;
    onClose: () => void;
}

interface FolderRow {
    id: string | null;
    name: string;
    depth: number;
}

function flattenFolders(nodes: HostTreeNode[], depth: number = 0): FolderRow[] {
    const result: FolderRow[] = [];
    for (const n of nodes) {
        if (n.type === 'folder') {
            result.push({ id: n.id, name: n.name, depth });
            if (n.children) {
                result.push(...flattenFolders(n.children, depth + 1));
            }
        }
    }
    return result;
}

export const SaveToHostTreeDialog: React.FC<SaveToHostTreeDialogProps> = ({
    open,
    initialName,
    protocol,
    config,
    onClose,
}) => {
    const { t } = useTranslation();
    const hostManager = useHostManager();
    const [name, setName] = useState(initialName);
    const [parentId, setParentId] = useState<string | null>(null);
    const [creatingFolder, setCreatingFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    /** Set the moment the user clicks a folder row. From then on nothing
     *  recomputes the selection for them — see the effect below. Mirrored into
     *  a ref so the suggestion effect can read it without listing it as a
     *  dependency, which would make the effect re-run on the very click that
     *  is supposed to stop it. */
    const [parentTouched, setParentTouched] = useState(false);
    const touchedRef = useRef(false);
    const [placement, setPlacement] = useState<PlacementResult>({ kind: 'noPrefixes' });
    const nameInputRef = useRef<HTMLInputElement>(null);
    const newFolderInputRef = useRef<HTMLInputElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);

    const prefixPlacement = useSettingsStore((s) => s.netbox.prefixPlacement);

    const entry = useMemo(() => buildHostEntryFromConfig(protocol, config), [protocol, config]);

    /**
     * Held in refs, not read from the closure, so the reset effect below can
     * consult them WITHOUT listing them as dependencies.
     *
     * `hostManager.tree` is replaced whenever another window syncs. If the
     * suggestion were a dependency, a background sync while this dialog is open
     * would recompute it and silently overwrite a folder the user had already
     * picked. Read once, on open.
     */
    const treeRef = useRef(hostManager.tree);
    const entryRef = useRef(entry);
    const placementEnabledRef = useRef(prefixPlacement);

    // Mirrored in an effect, not during render (`react-hooks/refs`). Declared
    // FIRST so it commits before the suggestion effect below reads it.
    useEffect(() => {
        treeRef.current = hostManager.tree;
        entryRef.current = entry;
        placementEnabledRef.current = prefixPlacement;
    });

    useEffect(() => {
        if (open) {
            /* eslint-disable react-hooks/set-state-in-effect */
            setName(initialName);
            setCreatingFolder(false);
            setNewFolderName('');
            setParentTouched(false);
            touchedRef.current = false;
            setParentId(null);
            setPlacement({ kind: 'noPrefixes' });
            /* eslint-enable react-hooks/set-state-in-effect */
        }
    }, [open, initialName]);

    /**
     * Preselect the folder whose NetBox prefix covers this address.
     *
     * No new control: the folder list is already here, so changing the
     * suggestion is one click on another row — the plainest override there is.
     *
     * Separate from the reset above, and keyed on `ready`, because the host
     * tree loads asynchronously (credential migration, then the eager decrypt).
     * A dialog opened before that finishes would otherwise match against an
     * empty tree and suggest nothing. Kept out of the reset effect so a late
     * `ready` cannot wipe a name the user is halfway through typing.
     */
    const treeReady = hostManager.ready;
    useEffect(() => {
        if (!open || !treeReady || touchedRef.current) return;
        const address = entryRef.current?.host;
        const result: PlacementResult = placementEnabledRef.current && address
            ? suggestFolderForHost(collectPrefixFolders(treeRef.current), address)
            : { kind: 'noPrefixes' };
        /* eslint-disable react-hooks/set-state-in-effect */
        setPlacement(result);
        setParentId(result.kind === 'one' ? result.folder.id : null);
        /* eslint-enable react-hooks/set-state-in-effect */
    }, [open, treeReady, initialName]);

    useEffect(() => {
        if (creatingFolder) {
            newFolderInputRef.current?.focus();
        }
    }, [creatingFolder]);

    const folderRows = useMemo<FolderRow[]>(
        () => [{ id: null, name: t('dialogs.saveToHostTree.rootFolder'), depth: 0 }, ...flattenFolders(hostManager.tree)],
        [hostManager.tree, t],
    );

    const canSave = name.trim().length > 0 && entry !== null;
    const canCreateFolder = newFolderName.trim().length > 0;

    const handleSave = () => {
        const trimmed = name.trim();
        if (!trimmed || !entry) return;
        hostManager.addHost(parentId, trimmed, entry);
        onClose();
    };

    const handleNewFolderClick = () => {
        setNewFolderName('');
        setCreatingFolder(true);
    };

    const handleCreateFolder = () => {
        const trimmed = newFolderName.trim();
        if (!trimmed) return;
        const newId = hostManager.addFolder(parentId, trimmed);
        // Creating a folder and landing in it is as deliberate a choice as
        // clicking a row, so it stops the suggestion the same way.
        touchedRef.current = true;
        setParentTouched(true);
        setParentId(newId);
        setNewFolderName('');
        setCreatingFolder(false);
    };

    const handleCancelCreateFolder = () => {
        setNewFolderName('');
        setCreatingFolder(false);
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={t('dialogs.saveToHostTree.title')}
            className="save-to-tree-modal"
            width={{ width: '90%', minWidth: 360, maxWidth: 460 }}
            footer={
                <>
                    <button className="btn-secondary" onClick={onClose}>
                        {t('common.cancel')}
                    </button>
                    {entry !== null && (
                        <button className="btn-primary" onClick={handleSave} disabled={!canSave}>
                            {t('common.save')}
                        </button>
                    )}
                </>
            }
        >
            <div
                ref={modalRef}
                // Keys are kept off the app behind the dialog — Ctrl+F would
                // otherwise open the terminal's find bar while the user is
                // naming a folder. Escape is the one exception: it belongs to
                // the dialog stack, which knows which dialog is in front.
                onKeyDown={(e) => {
                    if (e.key !== 'Escape') e.stopPropagation();
                }}
            >
                {entry === null ? (
                    <p className="save-to-tree-error">
                        {t('dialogs.saveToHostTree.unsupported')}
                    </p>
                ) : (
                    <>
                        <div className="modal-form-group">
                            <label>{t('dialogs.saveToHostTree.nameLabel')}</label>
                            <input
                                ref={nameInputRef}
                                autoFocus
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleSave();
                                    }
                                }}
                            />
                        </div>
                        <div className="modal-form-group">
                            <label>{t('dialogs.saveToHostTree.folderLabel')}</label>
                            {/* Only ever a sentence about what was picked and why.
                                `noPrefixes` / `notAnAddress` / `unmatched` all
                                render nothing: a user who has not set this up
                                must not see a line they cannot act on. */}
                            {!parentTouched && placement.kind === 'one' && (
                                <span className="save-to-tree-netbox-hint">
                                    {t('dialogs.saveToHostTree.netboxSuggested', {
                                        prefix: formatPrefix(placement.folder.prefix),
                                    })}
                                </span>
                            )}
                            {!parentTouched && placement.kind === 'ambiguous' && (
                                <span className="save-to-tree-netbox-hint">
                                    {t('dialogs.saveToHostTree.netboxAmbiguous', {
                                        prefix: formatPrefix(placement.folders[0].prefix),
                                        folders: placement.folders.map((f) => f.name).join(', '),
                                    })}
                                </span>
                            )}
                            <div className="save-to-tree-folder-list" role="listbox">
                                {folderRows.map((row) => {
                                    const isSelected = row.id === parentId;
                                    const showInlineInput = creatingFolder && isSelected;
                                    return (
                                        <React.Fragment key={row.id ?? '__root__'}>
                                            <div
                                                role="option"
                                                aria-selected={isSelected}
                                                className={`save-to-tree-folder-row${isSelected ? ' selected' : ''}`}
                                                style={{ paddingLeft: `${8 + row.depth * 16}px` }}
                                                onClick={() => {
                                                    touchedRef.current = true;
                                                    setParentTouched(true);
                                                    setParentId(row.id);
                                                }}
                                            >
                                                <span className="save-to-tree-folder-icon" aria-hidden>📁</span>
                                                <span className="save-to-tree-folder-name">{row.name}</span>
                                            </div>
                                            {showInlineInput && (
                                                <div
                                                    className="save-to-tree-inline-input-row"
                                                    style={{ paddingLeft: `${8 + (row.depth + 1) * 16}px` }}
                                                >
                                                    <input
                                                        ref={newFolderInputRef}
                                                        type="text"
                                                        placeholder={t('dialogs.saveToHostTree.newFolderPlaceholder')}
                                                        value={newFolderName}
                                                        onChange={(e) => setNewFolderName(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            e.stopPropagation();
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                handleCreateFolder();
                                                            } else if (e.key === 'Escape') {
                                                                e.preventDefault();
                                                                handleCancelCreateFolder();
                                                            }
                                                        }}
                                                    />
                                                    <button
                                                        className="btn-primary"
                                                        onClick={handleCreateFolder}
                                                        disabled={!canCreateFolder}
                                                    >
                                                        {t('dialogs.saveToHostTree.create')}
                                                    </button>
                                                    <button
                                                        className="btn-secondary"
                                                        onClick={handleCancelCreateFolder}
                                                    >
                                                        {t('common.cancel')}
                                                    </button>
                                                </div>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                            <button
                                className="save-to-tree-new-folder-btn"
                                onClick={handleNewFolderClick}
                                disabled={creatingFolder}
                            >
                                {t('dialogs.saveToHostTree.newFolder')}
                            </button>
                        </div>
                    </>
                )}
                </div>
        </Dialog>
    );
};
