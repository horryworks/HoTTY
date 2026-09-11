import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { HostTreeNode } from '../../types/appTypes';
import { summarizeFolder } from '../../utils/folderSummary';
import { formatPrefix } from '../../utils/cidr';
import { nodeIcon } from '../../utils/nodeIcon';
import './FolderDetails.css';

/**
 * What a folder holds, shown where the connection form sits while a folder is
 * the selected node.
 *
 * Read-only on purpose. Every action a folder has — open all, sort by IP range,
 * add, rename, delete — already lives on its context menu, and those carry
 * confirmations this panel would have to duplicate (the open-all threshold, the
 * NetBox delete warning). A second, quieter path to them is how the two drift.
 *
 * Sections with nothing to say render nothing at all, rather than an empty
 * frame: a hand-made folder shows only its contents, and no NetBox row or IP
 * range heading appears anywhere.
 *
 * A row selects, and nothing more. Double-click-to-connect cannot work here:
 * the single click that precedes it selects the host, which swaps this panel
 * out for the connection form, so the second click never lands on this row.
 * Measured, not assumed — the handler fired zero times.
 */

interface FolderDetailsProps {
    folder: HostTreeNode;
    /** Select a child, exactly as clicking its row in the tree would. */
    onSelectChild: (node: HostTreeNode) => void;
}

export const FolderDetails: React.FC<FolderDetailsProps> = ({
    folder,
    onSelectChild,
}) => {
    const { t } = useTranslation();
    const summary = useMemo(() => summarizeFolder(folder), [folder]);

    const link = folder.netbox;
    // The container is a NetBox folder in the data, but its name and place
    // belong to the user (ADR-018), so it gets no badge either.
    const kindLabel =
        link?.kind === 'region'
            ? t('hostTree.folderDetails.kindRegion')
            : link?.kind === 'site'
                ? t('hostTree.folderDetails.kindSite')
                : null;

    return (
        <div className="folder-details">
            <div className="folder-details-header">
                <span className="folder-details-icon" aria-hidden="true">{nodeIcon(folder)}</span>
                <span className="folder-details-name">{folder.name}</span>
                {kindLabel && (
                    <span className="folder-details-badge" title={t('hostTree.netbox.managedTitle')}>
                        {t('hostTree.folderDetails.badge', { kind: kindLabel })}
                    </span>
                )}
            </div>

            {link?.missing && (
                <div className="folder-details-warning" role="status">
                    {link.missingSince
                        ? t('hostTree.folderDetails.missingSince', {
                            when: new Date(link.missingSince).toLocaleString(),
                        })
                        : t('hostTree.netbox.missingTitle')}
                </div>
            )}

            {summary.prefixes.length > 0 && (
                <section className="folder-details-section">
                    <h4 className="folder-details-section-title">
                        {t('hostTree.folderDetails.ipRanges')}
                    </h4>
                    <ul className="folder-details-prefixes">
                        {summary.prefixes.map((p) => {
                            const text = formatPrefix(p);
                            return <li key={text} className="folder-details-prefix">{text}</li>;
                        })}
                    </ul>
                    {summary.unparsedPrefixes.length > 0 && (
                        <span className="folder-details-note">
                            {t('hostTree.folderDetails.unreadableRanges', {
                                count: summary.unparsedPrefixes.length,
                            })}
                        </span>
                    )}
                </section>
            )}

            <section className="folder-details-section">
                <h4 className="folder-details-section-title">
                    {t('hostTree.folderDetails.contents')}
                    <span className="folder-details-counts">
                        {t('hostTree.folderDetails.counts', {
                            folders: summary.folders.length,
                            hosts: summary.hosts.length,
                        })}
                    </span>
                </h4>

                {summary.folders.length === 0 && summary.hosts.length === 0 ? (
                    <p className="folder-details-empty">{t('hostTree.folderDetails.empty')}</p>
                ) : (
                    <ul className="folder-details-children">
                        {summary.folders.map((child) => (
                            <li key={child.id}>
                                <button
                                    type="button"
                                    className="folder-details-row"
                                    onClick={() => onSelectChild(child)}
                                >
                                    <span className="folder-details-row-icon" aria-hidden="true">
                                        {nodeIcon(child)}
                                    </span>
                                    <span className="folder-details-row-name">{child.name}</span>
                                </button>
                            </li>
                        ))}
                        {summary.hosts.map(({ node, address, range }) => (
                            <li key={node.id}>
                                <button
                                    type="button"
                                    className="folder-details-row"
                                    onClick={() => onSelectChild(node)}
                                >
                                    <span className="folder-details-row-icon" aria-hidden="true">
                                        {nodeIcon(node)}
                                    </span>
                                    <span className="folder-details-row-name">{node.name}</span>
                                    <span className="folder-details-row-address">{address}</span>
                                    {range === 'out' && (
                                        <span
                                            className="folder-details-row-warn"
                                            title={t('hostTree.folderDetails.outOfRangeTitle')}
                                        >
                                            {t('hostTree.folderDetails.outOfRange')}
                                        </span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
};
