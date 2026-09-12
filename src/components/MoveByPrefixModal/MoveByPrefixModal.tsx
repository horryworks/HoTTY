import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../Dialog/Dialog';
import { formatPrefix } from '../../utils/cidr';
import {
    collectPrefixFolders,
    findFolder,
    planPlacements,
} from '../../utils/netboxPlacement';
import type { PlacementMove } from '../../hooks/useHostManager';
import type { HostTreeNode } from '../../types/appTypes';
import './MoveByPrefixModal.css';

interface MoveByPrefixModalProps {
    tree: HostTreeNode[];
    /** The folder that was right-clicked; `null` = the whole tree. */
    scopeFolderId: string | null;
    onApply: (moves: PlacementMove[]) => void;
    onClose: () => void;
}

/**
 * Bulk placement: match every host in scope against the NetBox prefixes, show
 * what would move, then move only the rows still ticked.
 *
 * **It proposes; a person applies.** Nothing here runs on its own and no sync
 * calls it — a rule that moved hosts by itself would fight the user's own drags
 * last-writer-wins, which is exactly the conflict ADR-018's ownership split
 * exists to prevent (ADR-020).
 *
 * Two deliberate asymmetries in what the user may control:
 *
 *  * **Rows that will move are individually tickable.** Cheap to offer, and a
 *    per-row veto is a judgement the user genuinely holds.
 *  * **Ambiguous rows are read-only.** Once a preview asks for a decision on
 *    every row it stops being something you can check at a glance, and the
 *    ambiguity is a NetBox data problem that gets fixed by being visible, not
 *    by being resolved here.
 */
export const MoveByPrefixModal: React.FC<MoveByPrefixModalProps> = ({
    tree,
    scopeFolderId,
    onApply,
    onClose,
}) => {
    const { t } = useTranslation();

    const scopeFolder = scopeFolderId === null ? null : findFolder(tree, scopeFolderId);
    const scopeName = scopeFolder?.name ?? '';

    /**
     * Which folders may claim a host.
     *
     * Narrowing this is the only real defence against an estate that reuses
     * 192.168.1.0/24 at every site: matched inside one region those hosts stop
     * being ambiguous.
     */
    const [narrow, setNarrow] = useState(true);

    const scopedFolders = useMemo(
        () => (scopeFolderId === null ? [] : collectPrefixFolders(tree, scopeFolderId)),
        [tree, scopeFolderId],
    );
    const allFolders = useMemo(() => collectPrefixFolders(tree), [tree]);
    const canNarrow = scopeFolderId !== null && scopedFolders.length > 0;
    const folders = canNarrow && narrow ? scopedFolders : allFolders;

    const plan = useMemo(
        () => planPlacements(tree, scopeFolderId, folders),
        [tree, scopeFolderId, folders],
    );

    /** Host ids the user un-ticked. Everything starts ticked. */
    const [excluded, setExcluded] = useState<Set<string>>(new Set());
    const selected = plan.move.filter((m) => !excluded.has(m.host.id));

    const toggle = (hostId: string) => {
        setExcluded((prev) => {
            const next = new Set(prev);
            if (next.has(hostId)) next.delete(hostId);
            else next.add(hostId);
            return next;
        });
    };

    const folderName = (id: string | null): string =>
        id === null
            ? t('dialogs.moveByPrefix.topLevel')
            : findFolder(tree, id)?.name ?? t('dialogs.moveByPrefix.topLevel');

    const apply = () => {
        onApply(selected.map((m) => ({ hostId: m.host.id, targetFolderId: m.folder.id })));
    };

    return (
        <Dialog
            open
            onClose={onClose}
            title={t('dialogs.moveByPrefix.title')}
            titleExtra={
                <span className="mbp-scope">
                    {scopeFolder
                        ? t('dialogs.moveByPrefix.scopeFolder', { name: scopeName })
                        : t('dialogs.moveByPrefix.scopeTree')}
                </span>
            }
            width={640}
            // A preview: nothing is typed here and nothing is lost by clicking
            // away, so the backdrop stays a way out.
            dismissOnOutsideClick
            footer={
                <>
                    <button className="mbp-btn secondary" onClick={onClose}>
                        {t('dialogs.moveByPrefix.cancel')}
                    </button>
                    <button
                        className="mbp-btn primary"
                        onClick={apply}
                        disabled={selected.length === 0}
                    >
                        {t('dialogs.moveByPrefix.apply', { count: selected.length })}
                    </button>
                </>
            }
        >
                    {!plan.anyPrefixes && (
                        <p className="mbp-empty">{t('dialogs.moveByPrefix.noPrefixes')}</p>
                    )}

                    {plan.anyPrefixes && canNarrow && (
                        <div className="mbp-section">
                            <div className="mbp-section-title">{t('dialogs.moveByPrefix.matchIn')}</div>
                            <label className="mbp-radio">
                                <input
                                    type="radio"
                                    checked={narrow}
                                    onChange={() => setNarrow(true)}
                                />
                                {t('dialogs.moveByPrefix.matchScope', {
                                    name: scopeName,
                                    count: scopedFolders.length,
                                })}
                            </label>
                            <label className="mbp-radio">
                                <input
                                    type="radio"
                                    checked={!narrow}
                                    onChange={() => setNarrow(false)}
                                />
                                {t('dialogs.moveByPrefix.matchTree', { count: allFolders.length })}
                            </label>
                            <p className="mbp-hint">{t('dialogs.moveByPrefix.scopeHint')}</p>
                        </div>
                    )}

                    {plan.anyPrefixes && plan.move.length === 0 && plan.alreadyPlaced > 0 && (
                        <p className="mbp-empty">{t('dialogs.moveByPrefix.nothingToDo')}</p>
                    )}

                    {plan.move.length > 0 && (
                        <div className="mbp-section">
                            <div className="mbp-section-title">
                                {t('dialogs.moveByPrefix.willMove', { count: plan.move.length })}
                            </div>
                            <ul className="mbp-list">
                                {plan.move.map((m) => (
                                    <li key={m.host.id} className="mbp-row">
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={!excluded.has(m.host.id)}
                                                onChange={() => toggle(m.host.id)}
                                            />
                                            <span className="mbp-host">{m.host.name}</span>
                                            <span className="mbp-addr">{m.host.entry?.host}</span>
                                            <span className="mbp-move">
                                                {t('dialogs.moveByPrefix.moveRow', {
                                                    from: folderName(m.from),
                                                    to: m.folder.name,
                                                })}
                                            </span>
                                            <span className="mbp-prefix">{formatPrefix(m.folder.prefix)}</span>
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {plan.alreadyPlaced > 0 && (
                        <div className="mbp-section">
                            <div className="mbp-section-title mbp-muted">
                                {t('dialogs.moveByPrefix.alreadyPlaced', { count: plan.alreadyPlaced })}
                            </div>
                        </div>
                    )}

                    {plan.ambiguous.length > 0 && (
                        <div className="mbp-section">
                            <div className="mbp-section-title">
                                {t('dialogs.moveByPrefix.ambiguous', { count: plan.ambiguous.length })}
                            </div>
                            <p className="mbp-hint">{t('dialogs.moveByPrefix.ambiguousHint')}</p>
                            <ul className="mbp-list">
                                {plan.ambiguous.map((a) => (
                                    <li key={a.host.id} className="mbp-row mbp-row-static">
                                        <span className="mbp-host">{a.host.name}</span>
                                        <span className="mbp-addr">{a.host.entry?.host}</span>
                                        <span className="mbp-move">
                                            {a.folders.map((f) => f.name).join(', ')}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {plan.unmatched.length > 0 && (
                        <div className="mbp-section">
                            <div className="mbp-section-title mbp-muted">
                                {t('dialogs.moveByPrefix.unmatched', { count: plan.unmatched.length })}
                            </div>
                            <ul className="mbp-list">
                                {plan.unmatched.map((u) => (
                                    <li key={u.host.id} className="mbp-row mbp-row-static mbp-muted">
                                        <span className="mbp-host">{u.host.name}</span>
                                        <span className="mbp-addr">{u.host.entry?.host}</span>
                                        <span className="mbp-move">
                                            {u.reason === 'notAnAddress'
                                                ? t('dialogs.moveByPrefix.reasonNotAnAddress')
                                                : t('dialogs.moveByPrefix.reasonNoMatch')}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
        </Dialog>
    );
};
