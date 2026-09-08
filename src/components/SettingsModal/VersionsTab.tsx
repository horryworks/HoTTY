import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import { renderMarkdown } from '../../utils/markdown';
import { MarkdownContent } from '../MarkdownContent/MarkdownContent';
import type { ReleaseEntry, UpdaterProgress } from '../../types/appTypes';
import './VersionsTab.css';

function formatSize(bytes: number): string {
    if (bytes <= 0) return '';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function percentOf(progress: UpdaterProgress): number {
    if (progress.total <= 0) return 0;
    return Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
}

/**
 * Pick any published version and switch to it — forwards or backwards.
 *
 * The backend does the fetching, verifying and installing; this only ever hands
 * it a tag (see `tauriService.installVersion`). Release notes are rendered here
 * so that changing version never needs a trip out to the browser.
 *
 * Each row carries its own Upgrade/Downgrade button. There is deliberately no
 * single install button below the list: one used to live there, and picking a
 * version in the list appeared to do nothing until you found it.
 */
export function VersionsTab() {
    const { t, i18n } = useTranslation();
    const [releases, setReleases] = useState<ReleaseEntry[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [currentVersion, setCurrentVersion] = useState('');
    const [showPrereleases, setShowPrereleases] = useState(false);
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [progress, setProgress] = useState<UpdaterProgress | null>(null);
    // Which tag is installing, not merely "is something installing" — the row
    // that is running says so in place of its own button.
    const [installingTag, setInstallingTag] = useState<string | null>(null);
    const busy = installingTag !== null;

    const load = useCallback(async (refresh: boolean) => {
        setError(null);
        try {
            setReleases(await tauriService.listReleases(refresh));
        } catch (e) {
            setReleases([]);
            setError(String(e));
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        void tauriService.getAppVersion().then((v) => {
            if (cancelled) return;
            setCurrentVersion(v);
            // Someone already on a beta is looking for betas; someone on a
            // stable build is not, until they say so.
            setShowPrereleases(v.includes('-'));
        });
        void load(false);
        return () => {
            cancelled = true;
        };
    }, [load]);

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let cancelled = false;
        void tauriService
            .onUpdaterProgress((p) => setProgress(p))
            .then((fn) => {
                if (cancelled) fn();
                else unlisten = fn;
            })
            .catch(() => {
                /* progress is a nicety; its absence must not break the tab */
            });
        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);

    const visible = useMemo(
        () => (releases ?? []).filter((r) => showPrereleases || !r.prerelease),
        [releases, showPrereleases],
    );

    const selected = useMemo(
        () => visible.find((r) => r.tag === selectedTag) ?? null,
        [visible, selectedTag],
    );

    const handleInstall = async (entry: ReleaseEntry) => {
        setInstallingTag(entry.tag);
        setError(null);
        setProgress(null);
        try {
            await tauriService.installVersion(
                entry.tag,
                i18n.language.startsWith('ja') ? 'ja' : 'en',
            );
            // Reached only when the native dialog was declined or the download
            // was cancelled — on success the app exits instead of returning.
        } catch (e) {
            setError(String(e));
        } finally {
            setInstallingTag(null);
            setProgress(null);
        }
    };

    const loading = releases === null;

    return (
        <div className="versions-tab">
            <div className="versions-head">
                <span className="versions-current">
                    {t('settings.versions.installedLabel', { version: currentVersion })}
                </span>
                <button
                    className="versions-refresh"
                    onClick={() => void load(true)}
                    disabled={busy || loading}
                >
                    {t('settings.versions.refresh')}
                </button>
            </div>

            <label className="versions-toggle">
                <input
                    type="checkbox"
                    checked={showPrereleases}
                    onChange={(e) => setShowPrereleases(e.target.checked)}
                    disabled={busy}
                />
                {t('settings.versions.showPrereleases')}
            </label>

            <ul className="versions-list">
                {loading && <li className="versions-status">{t('settings.versions.loading')}</li>}
                {!loading && visible.length === 0 && (
                    <li className="versions-status">{t('settings.versions.empty')}</li>
                )}
                {visible.map((r) => {
                    const isSelected = r.tag === selectedTag;
                    const isInstalling = r.tag === installingTag;
                    const size = r.size > 0 ? ` (${formatSize(r.size)})` : '';
                    // The button face says which direction; its tooltip and its
                    // accessible name say exactly what will happen, so a screen
                    // reader listing buttons is not read "Upgrade" twenty times.
                    const actionTitle = r.installable
                        ? `${t('settings.versions.install', { version: r.version })}${size}`
                        : t('settings.versions.notInstallable');

                    return (
                        <li key={r.tag}>
                            <div className={`versions-row${isSelected ? ' selected' : ''}`}>
                                <button
                                    type="button"
                                    className="versions-select"
                                    aria-expanded={isSelected}
                                    aria-controls="versions-notes"
                                    onClick={() => setSelectedTag(r.tag)}
                                >
                                    <span className="versions-name">{r.version}</span>
                                    {r.relation === 'current' && (
                                        <span className="versions-badge current">
                                            {t('settings.versions.badgeCurrent')}
                                        </span>
                                    )}
                                    {r.prerelease && (
                                        <span className="versions-badge beta">
                                            {t('settings.versions.badgePrerelease')}
                                        </span>
                                    )}
                                    {!r.installable && (
                                        <span
                                            className="versions-badge warn"
                                            title={t('settings.versions.notInstallable')}
                                        >
                                            !
                                        </span>
                                    )}
                                </button>

                                {isInstalling && (
                                    <span className="versions-installing">
                                        {t('settings.versions.installing')}
                                    </span>
                                )}
                                {/* The running version is where you already are:
                                    there is nothing to switch to. */}
                                {!isInstalling && r.relation !== 'current' && (
                                    <button
                                        type="button"
                                        className={`versions-action ${
                                            r.relation === 'newer' ? 'upgrade' : 'downgrade'
                                        }`}
                                        title={actionTitle}
                                        aria-label={actionTitle}
                                        disabled={busy || !r.installable}
                                        onClick={() => {
                                            // Select first, so the release notes
                                            // — and the downgrade caveat — are on
                                            // screen behind the native dialog.
                                            setSelectedTag(r.tag);
                                            void handleInstall(r);
                                        }}
                                    >
                                        {r.relation === 'newer'
                                            ? t('settings.versions.upgrade')
                                            : t('settings.versions.downgrade')}
                                    </button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>

            <div className="versions-notes" id="versions-notes">
                {!selected && !loading && (
                    <p className="versions-status">{t('settings.versions.selectPrompt')}</p>
                )}
                {selected && selected.notes && (
                    <MarkdownContent sanitizedHtml={renderMarkdown(selected.notes)} />
                )}
                {selected && !selected.notes && (
                    <p className="versions-status">{t('settings.versions.noNotes')}</p>
                )}
            </div>

            {selected?.relation === 'older' && (
                <p className="versions-warning">{t('settings.versions.downgradeNote')}</p>
            )}
            {error && (
                <p className="versions-error">{t('settings.versions.failed', { message: error })}</p>
            )}
            {progress && (
                <div className="versions-progress">
                    <div className="versions-progress-label">
                        {progress.phase === 'downloading' &&
                            t('settings.versions.downloading', { percent: percentOf(progress) })}
                        {progress.phase === 'verifying' && t('settings.versions.verifying')}
                        {progress.phase === 'launching' && t('settings.versions.launching')}
                    </div>
                    <div className="versions-progress-track">
                        <div
                            className="versions-progress-bar"
                            style={{
                                width:
                                    progress.phase === 'downloading'
                                        ? `${percentOf(progress)}%`
                                        : '100%',
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Cancel lives here rather than inside the progress block: an
                install starts with no progress at all while the native consent
                dialog is up, and that is exactly when cancelling matters. */}
            {busy && (
                <div className="versions-actions">
                    <button
                        className="versions-btn"
                        onClick={() => void tauriService.cancelVersionInstall().catch(() => {})}
                    >
                        {t('settings.versions.cancel')}
                    </button>
                </div>
            )}
        </div>
    );
}
