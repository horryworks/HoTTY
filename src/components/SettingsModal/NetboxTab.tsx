import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import { useNetboxSync } from '../../hooks/useNetboxSync';
import { useHostManager } from '../../hooks/useHostManager';
import type { NetboxProbeResult } from '../../types/appTypes';
import {
    SITE_ID_OTHER,
    customKeyLooksValid,
    selectionFor,
    siteIdFieldToSend,
    siteIdOptions,
    siteIdOutcome,
} from '../../utils/netboxSiteIdField';
import { MoveByPrefixModal } from '../MoveByPrefixModal/MoveByPrefixModal';
import HelpTooltip from '../HelpTooltip/HelpTooltip';
import './NetboxTab.css';

/** Shown under the Site ID picker so the chosen field's effect is visible
 *  before a sync runs. Placeholder values only — never a real site. */
const EXAMPLE_CODE = 'SITE-01';
const EXAMPLE_NAME = 'Example Site';

export function NetboxTab() {
    const netbox = useSettingsStore((s) => s.netbox);
    const update = useSettingsStore((s) => s.update);
    const { t } = useTranslation();
    const { syncing, sync, report } = useNetboxSync();
    // Its own instance, the way SaveToHostTreeDialog takes one: every
    // useHostManager shares the same persisted tree and mirrors writes into
    // the others, and this tab is only mounted while it is the open tab.
    const hostManager = useHostManager();
    const [scanOpen, setScanOpen] = useState(false);
    /** Hosts moved by the last scan, so the result lands next to the button. */
    const [scanMoved, setScanMoved] = useState<number | null>(null);

    const [tokenInput, setTokenInput] = useState('');
    const [hasToken, setHasToken] = useState(false);
    /** The user asked to swap a saved token for a different one. Reset on a
     *  successful connect, so the tab settles back to the "saved" state. */
    const [replacingToken, setReplacingToken] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [probe, setProbe] = useState<NetboxProbeResult | null>(null);
    const [connectError, setConnectError] = useState<string | null>(null);

    // Initialised once from the stored setting. Later edits come from the form
    // itself; re-deriving on every render would fight the user's typing.
    const [form, setForm] = useState(() => selectionFor(netbox.siteIdField, null));
    const { selected, customKeyInput: customKey } = form;

    // Whether a token is already sealed in the backend store, so the tab can say
    // "connected" after a restart without asking for it again. The token itself
    // never comes back to the renderer.
    useEffect(() => {
        let alive = true;
        tauriService
            .netboxHasToken()
            .then((v) => {
                if (alive) setHasToken(v);
            })
            .catch(() => {
                /* an unreadable store simply reads as "not connected" */
            });
        return () => {
            alive = false;
        };
    }, []);

    const choices = probe?.siteIdFields ?? null;
    const options = siteIdOptions(choices, netbox.siteIdField);

    const applySiteId = useCallback(
        (nextSelected: string, nextKey: string) => {
            setForm({ selected: nextSelected, customKeyInput: nextKey });
            // A half-typed custom key is not persisted; the warning below the
            // box says why, and the previously saved value stays in force.
            if (nextSelected === SITE_ID_OTHER && nextKey.trim() && !customKeyLooksValid(nextKey)) {
                return;
            }
            update('netbox', { ...netbox, siteIdField: siteIdFieldToSend(nextSelected, nextKey) });
        },
        [netbox, update],
    );

    const handleConnect = useCallback(async () => {
        setConnecting(true);
        setConnectError(null);
        try {
            const result = await tauriService.netboxConnect(netbox.baseUrl, tokenInput);
            setProbe(result);
            if (result.authenticated) {
                // Never keep the token in renderer state once it is sealed.
                setTokenInput('');
                setHasToken(true);
                setReplacingToken(false);
            }
        } catch (err) {
            setProbe(null);
            setConnectError(err instanceof Error ? err.message : String(err));
        } finally {
            setConnecting(false);
        }
    }, [netbox.baseUrl, tokenInput]);

    const handleRefreshFields = useCallback(async () => {
        setConnecting(true);
        setConnectError(null);
        try {
            setProbe(await tauriService.netboxProbe(netbox.baseUrl));
        } catch (err) {
            setProbe(null);
            setConnectError(err instanceof Error ? err.message : String(err));
        } finally {
            setConnecting(false);
        }
    }, [netbox.baseUrl]);

    const handleDisconnect = useCallback(async () => {
        await tauriService.netboxDisconnect();
        setHasToken(false);
        setReplacingToken(false);
        setProbe(null);
    }, []);

    const isHttp = netbox.baseUrl.trim().toLowerCase().startsWith('http://');
    const customKeyInvalid =
        selected === SITE_ID_OTHER && customKey.trim().length > 0 && !customKeyLooksValid(customKey);

    const previewName = (() => {
        const field = siteIdFieldToSend(selected, customKey);
        return field ? `${EXAMPLE_CODE} ${EXAMPLE_NAME}` : EXAMPLE_NAME;
    })();

    const outcome = report ? siteIdOutcome(report.sites, report.sitesWithoutSiteId) : null;

    return (
        <>
            {/* ── Server ── */}
            <div className="settings-card">
                <h3 className="settings-section-title">{t('settings.netbox.serverSection')}</h3>

                <div className="settings-group">
                    <label>
                        {t('settings.netbox.baseUrl')}
                        <HelpTooltip text={t('settings.netbox.baseUrlHelp')} />
                    </label>
                    <input
                        type="text"
                        value={netbox.baseUrl}
                        onChange={(e) => update('netbox', { ...netbox, baseUrl: e.target.value })}
                        placeholder={t('settings.netbox.baseUrlPlaceholder')}
                        spellCheck={false}
                    />
                    {isHttp && (
                        <div className="settings-netbox-status settings-netbox-status--warn">
                            {t('settings.netbox.insecureWarning')}
                        </div>
                    )}
                </div>

                <div className="settings-group">
                    <label>
                        {t('settings.netbox.token')}
                        <HelpTooltip text={t('settings.netbox.tokenHelp')} />
                    </label>
                    {/* 🚨 An empty password box is NOT shown while a token is
                        saved. The token can never come back to the renderer, so
                        that box is always blank — and a blank "API token" field
                        with a Connect button beside it reads as "your token is
                        gone", which sent a user to paste theirs in again three
                        times in one sitting. Say the state instead, and make
                        replacing it a deliberate step. */}
                    {hasToken && !replacingToken ? (
                        <div className="settings-netbox-row settings-netbox-row--saved">
                            <span className="settings-help-text">
                                {t('settings.netbox.tokenSaved')}
                            </span>
                            <button className="settings-button" type="button" onClick={() => setReplacingToken(true)}>
                                {t('settings.netbox.replaceToken')}
                            </button>
                            <button className="settings-button" type="button" onClick={handleDisconnect}>
                                {t('settings.netbox.disconnect')}
                            </button>
                        </div>
                    ) : (
                        <div className="settings-netbox-row">
                            <input
                                type="password"
                                value={tokenInput}
                                onChange={(e) => setTokenInput(e.target.value)}
                                placeholder={t('settings.netbox.tokenPlaceholder')}
                                autoComplete="off"
                            />
                            <button
                                className="settings-button"
                                type="button"
                                onClick={handleConnect}
                                disabled={connecting || !tokenInput || !netbox.baseUrl}
                            >
                                {connecting
                                    ? t('settings.netbox.connecting')
                                    : t('settings.netbox.connect')}
                            </button>
                            {hasToken && (
                                <button
                                    className="settings-button"
                                    type="button"
                                    onClick={() => {
                                        setReplacingToken(false);
                                        setTokenInput('');
                                    }}
                                >
                                    {t('common.cancel')}
                                </button>
                            )}
                        </div>
                    )}
                    <span className="settings-help-text">
                        {t('settings.netbox.disconnectHelp')}
                    </span>
                </div>

                {connectError && (
                    <div className="settings-netbox-status settings-netbox-status--error">
                        {connectError}
                    </div>
                )}
                {probe && <ConnectionResult probe={probe} />}
            </div>

            {/* ── Site ID field ── */}
            <div className="settings-card">
                <h3 className="settings-section-title">{t('settings.netbox.siteIdSection')}</h3>

                <div className="settings-group">
                    <label>
                        {t('settings.netbox.siteIdLabel')}
                        <HelpTooltip text={t('settings.netbox.siteIdHelp')} />
                    </label>
                    <select
                        value={selected}
                        onChange={(e) => applySiteId(e.target.value, customKey)}
                    >
                        {options.map((o) => (
                            <option key={o.value || 'none'} value={o.value}>
                                {o.kind === 'none'
                                    ? t('settings.netbox.siteIdNone')
                                    : o.kind === 'other'
                                        ? t('settings.netbox.siteIdOther')
                                        : o.label}
                            </option>
                        ))}
                    </select>

                    {selected === SITE_ID_OTHER && (
                        <>
                            <input
                                type="text"
                                value={customKey}
                                onChange={(e) => applySiteId(SITE_ID_OTHER, e.target.value)}
                                placeholder={t('settings.netbox.siteIdCustomKeyPlaceholder')}
                                spellCheck={false}
                            />
                            {customKeyInvalid && (
                                <div className="settings-netbox-status settings-netbox-status--warn">
                                    {t('settings.netbox.siteIdCustomKeyInvalid')}
                                </div>
                            )}
                        </>
                    )}

                    <span className="settings-help-text">
                        {t('settings.netbox.siteIdExample', { example: previewName })}
                    </span>
                </div>

                {/* 🚨 "could not read the definitions" and "there are none" must
                    never be collapsed: the first has a way forward (type the
                    name yourself), the second does not. */}
                {choices && !choices.customFieldsReadable && (
                    <div className="settings-netbox-status settings-netbox-status--warn">
                        {t('settings.netbox.customFieldsDenied')}
                    </div>
                )}
                {choices && choices.customFieldsReadable && choices.customFields.length === 0 && (
                    <span className="settings-help-text">
                        {t('settings.netbox.customFieldsEmpty')}
                    </span>
                )}

                <button
                    className="settings-button"
                    type="button"
                    onClick={handleRefreshFields}
                    disabled={connecting || !hasToken || !netbox.baseUrl}
                >
                    {t('settings.netbox.refreshFields')}
                </button>
            </div>

            {/* ── Sync ── */}
            <div className="settings-card">
                <h3 className="settings-section-title">{t('settings.netbox.syncSection')}</h3>

                <label className="settings-checkbox">
                    <input
                        type="checkbox"
                        checked={netbox.syncOnStartup}
                        onChange={(e) =>
                            update('netbox', { ...netbox, syncOnStartup: e.target.checked })
                        }
                    />
                    {t('settings.netbox.syncOnStartup')}
                    <HelpTooltip text={t('settings.netbox.syncOnStartupHelp')} />
                </label>

                <button
                    className="settings-button"
                    type="button"
                    onClick={() => void sync('manual')}
                    disabled={syncing || !netbox.baseUrl || !hasToken}
                >
                    {syncing ? t('settings.netbox.syncing') : t('settings.netbox.syncNow')}
                </button>

                {!netbox.baseUrl && (
                    <span className="settings-help-text">{t('settings.netbox.notConfigured')}</span>
                )}

                <div className="settings-netbox-summary">
                    <span className="settings-help-text">
                        {netbox.lastSyncAt
                            ? t('settings.netbox.lastSync', {
                                when: new Date(netbox.lastSyncAt).toLocaleString(),
                            })
                            : t('settings.netbox.neverSynced')}
                    </span>

                    {report && (
                        <>
                            <span className="settings-help-text">
                                {t('settings.netbox.summaryCounts', {
                                    regions: report.regions,
                                    sites: report.sites,
                                })}
                            </span>
                            {report.markedMissing + report.stillMissing > 0 && (
                                <span className="settings-help-text">
                                    {t('settings.netbox.summaryMissing', {
                                        count: report.markedMissing + report.stillMissing,
                                    })}
                                </span>
                            )}
                            {report.detached > 0 && (
                                <span className="settings-help-text">
                                    {t('settings.netbox.summaryDetached', {
                                        count: report.detached,
                                    })}
                                </span>
                            )}
                            {report.duplicatesAdopted > 0 && (
                                <span className="settings-help-text">
                                    {t('settings.netbox.summaryDuplicates', {
                                        count: report.duplicatesAdopted,
                                    })}
                                </span>
                            )}
                        </>
                    )}

                    {/* The one number that turns "nothing happened" into a
                        sentence: the wrong Site ID field fails silently. */}
                    {outcome && (
                        <div
                            className={`settings-netbox-status settings-netbox-status--${outcome.kind === 'none' ? 'warn' : 'info'
                                }`}
                        >
                            {outcome.kind === 'none'
                                ? t('settings.netbox.summarySiteIdNone', { sites: outcome.sites })
                                : t('settings.netbox.summarySiteIdPartial', {
                                    without: outcome.without,
                                    sites: outcome.sites,
                                })}
                        </div>
                    )}

                    {netbox.lastSyncError && (
                        <div className="settings-netbox-status settings-netbox-status--error">
                            {t('settings.netbox.lastError', { message: netbox.lastSyncError })}
                        </div>
                    )}
                </div>
            </div>

            {/* A section of its own rather than a line in Sync: the counters
                below only make sense next to the control that explains them,
                and folding them into the sync summary would mix two features
                into one paragraph. */}
            <div className="settings-card">
                <h3 className="settings-section-title">{t('settings.netbox.placementSection')}</h3>

                <label className="settings-checkbox">
                    <input
                        type="checkbox"
                        checked={netbox.prefixPlacement}
                        onChange={(e) =>
                            update('netbox', { ...netbox, prefixPlacement: e.target.checked })
                        }
                    />
                    {t('settings.netbox.placementToggle')}
                    <HelpTooltip text={t('settings.netbox.placementHelp')} />
                </label>

                <span className="settings-help-text">
                    {t('settings.netbox.placementFetchNote')}
                </span>

                {/* The whole-tree scan already existed, on the tree's empty
                    background right-click — where nobody found it. Same modal
                    and the same whole-tree scope, just somewhere a user looking
                    for the feature will actually look. Disabled until the tree
                    has finished its load-time decrypt, or the scan would read an
                    empty tree and report nothing to do. */}
                {netbox.prefixPlacement && (
                    <div className="settings-netbox-scan">
                        <button
                            className="settings-button"
                            type="button"
                            disabled={!hostManager.ready}
                            onClick={() => {
                                setScanMoved(null);
                                setScanOpen(true);
                            }}
                        >
                            {t('settings.netbox.placementScan')}
                        </button>
                        <span className="settings-help-text">
                            {t('settings.netbox.placementScanHelp')}
                        </span>
                    </div>
                )}

                {scanMoved !== null && (
                    <div className="settings-netbox-status settings-netbox-status--info">
                        {t('settings.netbox.placementScanMoved', { count: scanMoved })}
                    </div>
                )}

                {/* Rendered here only for tidiness — it is a fixed overlay at
                    z-index 10001, one tier above the settings modal itself. */}
                {scanOpen && (
                    <MoveByPrefixModal
                        tree={hostManager.tree}
                        scopeFolderId={null}
                        onClose={() => setScanOpen(false)}
                        onApply={(moves) => {
                            setScanMoved(hostManager.applyPlacements(moves));
                            setScanOpen(false);
                        }}
                    />
                )}

                {netbox.prefixPlacement && report && (
                    <div className="settings-netbox-summary">
                        {/* The one number that says whether this feature is
                            actually doing anything. A NetBox whose prefixes all
                            hang off locations produces no error and no changed
                            folder, so without it "does nothing" and "is broken"
                            read the same. */}
                        {report.prefixes > 0 && (
                            <div
                                className={`settings-netbox-status settings-netbox-status--${report.foldersWithPrefixes === 0 ? 'warn' : 'info'
                                    }`}
                            >
                                {report.foldersWithPrefixes === 0
                                    ? t('settings.netbox.summaryPrefixesNoFolders', {
                                        count: report.prefixes,
                                    })
                                    : t('settings.netbox.summaryPrefixes', {
                                        count: report.prefixes,
                                        folders: report.foldersWithPrefixes,
                                    })}
                            </div>
                        )}
                        {report.prefixesSkipped > 0 && (
                            <span className="settings-help-text">
                                {t('settings.netbox.summaryPrefixesSkipped', {
                                    count: report.prefixesSkipped,
                                })}
                            </span>
                        )}
                        {report.prefixesUnparsed > 0 && (
                            <span className="settings-help-text">
                                {t('settings.netbox.summaryPrefixesUnparsed', {
                                    count: report.prefixesUnparsed,
                                })}
                            </span>
                        )}
                        {/* `denied` and `tooMany` both mean "nothing was read,
                            and nothing was cleared" — say which, because the
                            fixes are completely different. */}
                        {report.prefixesUnavailable === 'denied' && (
                            <div className="settings-netbox-status settings-netbox-status--warn">
                                {t('settings.netbox.prefixesDenied')}
                            </div>
                        )}
                        {report.prefixesUnavailable === 'tooMany' && (
                            <div className="settings-netbox-status settings-netbox-status--warn">
                                {t('settings.netbox.prefixesTooMany')}
                            </div>
                        )}
                        {report.prefixesUnavailable === 'disabled' && (
                            <span className="settings-help-text">
                                {t('settings.netbox.prefixesDisabled')}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}

/**
 * The three outcomes of a probe, kept apart on purpose.
 *
 * "Reached a NetBox but it refused the token" is the message that stops a user
 * editing a URL that was already correct — a bare 403 cannot tell the two apart.
 */
function ConnectionResult({ probe }: { probe: NetboxProbeResult }) {
    const { t } = useTranslation();

    if (probe.authenticated) {
        return (
            <div className="settings-netbox-status settings-netbox-status--ok">
                {probe.netboxVersion
                    ? t('settings.netbox.resultConnected', { version: probe.netboxVersion })
                    : t('settings.netbox.resultConnectedNoVersion')}
            </div>
        );
    }
    if (probe.reachable) {
        return (
            <div className="settings-netbox-status settings-netbox-status--warn">
                {probe.apiVersion
                    ? t('settings.netbox.resultRefused', { apiVersion: probe.apiVersion })
                    : t('settings.netbox.resultRefusedNoVersion')}
            </div>
        );
    }
    return (
        <div className="settings-netbox-status settings-netbox-status--error">
            {probe.httpStatus
                ? t('settings.netbox.resultNotNetbox', { status: probe.httpStatus })
                : t('settings.netbox.resultUnreachable')}
        </div>
    );
}
