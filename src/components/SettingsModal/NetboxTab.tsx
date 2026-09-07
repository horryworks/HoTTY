import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import { useNetboxSync } from '../../hooks/useNetboxSync';
import type { NetboxProbeResult } from '../../types/appTypes';
import {
    SITE_ID_OTHER,
    customKeyLooksValid,
    selectionFor,
    siteIdFieldToSend,
    siteIdOptions,
    siteIdOutcome,
} from '../../utils/netboxSiteIdField';
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

    const [tokenInput, setTokenInput] = useState('');
    const [hasToken, setHasToken] = useState(false);
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
                    <div className="settings-netbox-row">
                        <input
                            type="password"
                            value={tokenInput}
                            onChange={(e) => setTokenInput(e.target.value)}
                            placeholder={t('settings.netbox.tokenPlaceholder')}
                            autoComplete="off"
                        />
                        <button
                            type="button"
                            onClick={handleConnect}
                            disabled={connecting || !tokenInput || !netbox.baseUrl}
                        >
                            {connecting
                                ? t('settings.netbox.connecting')
                                : t('settings.netbox.connect')}
                        </button>
                    </div>
                    {hasToken && (
                        <div className="settings-netbox-row settings-netbox-row--saved">
                            <span className="settings-help-text">
                                {t('settings.netbox.tokenSaved')}
                            </span>
                            <button type="button" onClick={handleDisconnect}>
                                {t('settings.netbox.disconnect')}
                            </button>
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
