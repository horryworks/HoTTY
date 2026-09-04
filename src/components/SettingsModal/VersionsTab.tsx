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
 */
export function VersionsTab() {
    const { t, i18n } = useTranslation();
    const [releases, setReleases] = useState<ReleaseEntry[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [currentVersion, setCurrentVersion] = useState('');
    const [showPrereleases, setShowPrereleases] = useState(false);
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [progress, setProgress] = useState<UpdaterProgress | null>(null);
    const [busy, setBusy] = useState(false);

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
        setBusy(true);
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
            setBusy(false);
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
                {visible.map((r) => (
                    <li key={r.tag}>
                        <button
                            className={`versions-row${r.tag === selectedTag ? ' selected' : ''}`}
                            onClick={() => setSelectedTag(r.tag)}
                            disabled={busy}
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
                    </li>
                ))}
            </ul>

            <div className="versions-notes">
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

            <div className="versions-actions">
                {busy && (
                    <button
                        className="versions-btn"
                        onClick={() => void tauriService.cancelVersionInstall().catch(() => {})}
                    >
                        {t('settings.versions.cancel')}
                    </button>
                )}
                <button
                    className="versions-btn versions-btn-primary"
                    disabled={!selected || !selected.installable || busy}
                    onClick={() => selected && void handleInstall(selected)}
                >
                    {selected?.relation === 'current'
                        ? t('settings.versions.reinstall', { version: selected.version })
                        : t('settings.versions.install', { version: selected?.version ?? '' })}
                    {selected && selected.size > 0 ? ` (${formatSize(selected.size)})` : ''}
                </button>
            </div>
        </div>
    );
}
