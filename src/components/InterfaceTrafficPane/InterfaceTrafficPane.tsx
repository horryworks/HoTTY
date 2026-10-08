import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService, isEncrypted } from '../../services/tauriService';
import { useInterfaceTrafficEvents, TRAFFIC_HISTORY, type TrafficHistory } from '../../hooks/useInterfaceTrafficEvents';
import { useSettingsStore } from '../../stores/settingsStore';
import { recallPaneMemory, useRememberPane } from '../../hooks/usePaneMemory';
import { logError } from '../../utils/logger';
import i18n from '../../i18n';
import { DEFAULT_SNMP_DEVICE, deviceKey, removeDevice, upsertDevice } from '../../utils/snmpDevices';
import {
  NO_VALUE,
  adminStatusKey,
  formatBps,
  formatCount,
  formatPps,
  formatSpeed,
  formatUtil,
  formatUptime,
  operStatusKey,
} from '../../utils/trafficFormat';
import { defaultAscending, filterRows, sortRows, type SortKey } from './interfaceTrafficHelpers';
import { LineSparkline, RunButton, RunStatus, Segmented } from '../PaneTools/PaneTools';
import type {
  SnmpAuthProtocol,
  SnmpConfig,
  SnmpIfRow,
  SnmpPrivProtocol,
  SnmpSavedDevice,
  SnmpSecurityLevel,
} from '../../types/appTypes';
import './InterfaceTrafficPane.css';

interface InterfaceTrafficPaneProps {
  paneId: string;
  active: boolean;
}

// SNMP polls run the MIB walk on the device's control-plane CPU, so the floor is
// deliberately higher than the Ping Monitor's 1s.
const INTERVAL_OPTIONS = [5000, 10000, 30000, 60000].map((value) => ({ value, label: `${value / 1000}s` }));

const AUTH_PROTOCOLS: SnmpAuthProtocol[] = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512'];
const PRIV_PROTOCOLS: SnmpPrivProtocol[] = ['des', 'aes128', 'aes192', 'aes256'];
const VERSION_OPTIONS = [
  { value: 'v2c' as const, label: 'v2c' },
  { value: 'v3' as const, label: 'v3' },
];

/** Utilization at or above this is drawn in the warning colour. */
const UTIL_WARN_PCT = 80;

/** The device fields without its secrets — what the form edits. */
function withoutSecrets(d: SnmpSavedDevice): SnmpSavedDevice {
  const rest = { ...d };
  delete rest.community;
  delete rest.authPassword;
  delete rest.privPassword;
  return rest;
}

function deviceLabel(d: SnmpSavedDevice): string {
  return d.sysName ? `${d.sysName} · ${d.host}` : d.host;
}

export function InterfaceTrafficPane({ paneId, active }: InterfaceTrafficPaneProps) {
  const { t } = useTranslation();
  const devices = useSettingsStore((s) => s.snmpDevices);
  const updateSettings = useSettingsStore((s) => s.update);

  // Kept across remounts: hiding the tab does not stop the watcher.
  const [form, setForm] = useState<SnmpSavedDevice>(() => recallPaneMemory(paneId, 'form', DEFAULT_SNMP_DEVICE));
  const [community, setCommunity] = useState(() => recallPaneMemory(paneId, 'community', ''));
  const [authPassword, setAuthPassword] = useState(() => recallPaneMemory(paneId, 'authPassword', ''));
  const [privPassword, setPrivPassword] = useState(() => recallPaneMemory(paneId, 'privPassword', ''));

  const [editing, setEditing] = useState(() => recallPaneMemory(paneId, 'editing', true));
  const [started, setStarted] = useState(() => recallPaneMemory(paneId, 'started', false));
  const [error, setError] = useState<string | null>(null);

  const [filterQuery, setFilterQuery] = useState(() => recallPaneMemory(paneId, 'filter', ''));
  const [upOnly, setUpOnly] = useState(() => recallPaneMemory(paneId, 'upOnly', true));
  useRememberPane(paneId, { 'form': form, 'community': community, 'authPassword': authPassword, 'privPassword': privPassword, 'editing': editing, 'started': started, 'filter': filterQuery, 'upOnly': upOnly });
  const [sortKey, setSortKey] = useState<SortKey>('ifIndex');
  const [sortAsc, setSortAsc] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  const { snapshot, receivedAt, history, watcherState, watcherMessage } = useInterfaceTrafficEvents(paneId);

  // The watcher ends on its own when it cannot connect, so "running" is what we
  // started minus what the backend says has ended.
  const running = started && watcherState !== 'error' && watcherState !== 'stopped';

  const updateForm = useCallback((patch: Partial<SnmpSavedDevice>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      // Another host or port is another device; the old one's name must not follow.
      if ((patch.host !== undefined && patch.host !== prev.host) || (patch.port !== undefined && patch.port !== prev.port)) {
        delete next.sysName;
      }
      return next;
    });
  }, [setForm]);

  /** Fill the form from a saved device, decrypting its passwords if it kept them. */
  const pickDevice = useCallback(async (d: SnmpSavedDevice) => {
    setForm(withoutSecrets(d));
    setError(null);
    const decrypt = async (value?: string) => {
      if (!value) return '';
      return isEncrypted(value) ? await tauriService.dpapiDecrypt(value) : value;
    };
    try {
      const [c, a, p] = await Promise.all([decrypt(d.community), decrypt(d.authPassword), decrypt(d.privPassword)]);
      setCommunity(c);
      setAuthPassword(a);
      setPrivPassword(p);
    } catch (e) {
      logError('InterfaceTraffic', i18n.t('notifications.errors.trafficSettingsRestore'), e);
    }
  }, []);

  const buildConfig = useCallback((): SnmpConfig => {
    const base: SnmpConfig = { host: form.host.trim(), port: form.port, version: form.version };
    if (form.version === 'v2c') return { ...base, community };
    const v3: SnmpConfig = {
      ...base,
      username: form.username.trim(),
      securityLevel: form.securityLevel,
      contextName: form.contextName.trim() || undefined,
    };
    if (form.securityLevel === 'noAuthNoPriv') return v3;
    v3.authProtocol = form.authProtocol;
    v3.authPassword = authPassword;
    if (form.securityLevel === 'authNoPriv') return v3;
    v3.privProtocol = form.privProtocol;
    v3.privPassword = privPassword;
    return v3;
  }, [form, community, authPassword, privPassword]);

  /** Keep this device at the front of the "used before" row. */
  const saveDevice = useCallback(async (d: SnmpSavedDevice) => {
    const entry: SnmpSavedDevice = { ...withoutSecrets(d), host: d.host.trim() };
    if (d.remember) {
      const encrypt = async (value: string) => (value ? await tauriService.dpapiEncrypt(value) : undefined);
      entry.community = await encrypt(community);
      entry.authPassword = await encrypt(authPassword);
      entry.privPassword = await encrypt(privPassword);
    }
    const current = useSettingsStore.getState().snmpDevices;
    const old = current.find((x) => deviceKey(x) === deviceKey(entry));
    updateSettings('snmpDevices', upsertDevice(current, { ...entry, sysName: entry.sysName ?? old?.sysName }));
  }, [community, authPassword, privPassword, updateSettings]);

  const handleConnect = useCallback(async () => {
    if (!form.host.trim()) {
      setError(t('panes.interfaceTraffic.errorNoHost'));
      return;
    }
    setError(null);
    setExpanded(new Set());
    try {
      await tauriService.snmpWatcherStart(paneId, buildConfig(), form.intervalMs);
      setStarted(true);
      setEditing(false);
      await saveDevice(form);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId, form, buildConfig, saveDevice, t]);

  const handleStop = useCallback(async () => {
    try {
      await tauriService.snmpWatcherStop(paneId);
      setStarted(false);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId]);

  const handleChange = useCallback(async () => {
    if (running) await handleStop();
    setEditing(true);
  }, [running, handleStop]);

  const handleInterval = useCallback(async (ms: number) => {
    updateForm({ intervalMs: ms });
    if (!running) return;
    try {
      await tauriService.snmpWatcherUpdateInterval(paneId, ms);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId, running, updateForm]);

  // Put the device's own name on its "used before" button once it is known.
  const sysName = snapshot?.sysName;
  useEffect(() => {
    if (!sysName || !form.host.trim()) return;
    const current = useSettingsStore.getState().snmpDevices;
    const i = current.findIndex((d) => deviceKey(d) === deviceKey(form));
    if (i < 0 || current[i].sysName === sysName) return;
    const next = [...current];
    next[i] = { ...next[i], sysName };
    updateSettings('snmpDevices', next);
  }, [sysName, form, updateSettings]);

  const rows = useMemo(() => snapshot?.interfaces ?? [], [snapshot]);
  const visibleRows = useMemo(
    () => sortRows(filterRows(rows, filterQuery, upOnly), sortKey, sortAsc),
    [rows, filterQuery, upOnly, sortKey, sortAsc],
  );

  // Rates need two polls. Until the second arrives, count down to it.
  const measuring = rows.length > 0 && rows.every((r) => r.bpsIn === undefined && r.bpsOut === undefined);
  useEffect(() => {
    if (!measuring) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [measuring]);
  const intervalMs = snapshot?.intervalMs ?? form.intervalMs;
  const nextInSecs = receivedAt === null ? Math.round(intervalMs / 1000) : Math.max(0, Math.ceil((receivedAt + intervalMs - now) / 1000));

  const staleMs = snapshot?.staleForMs;
  // No reply: rows carried over from an earlier poll, or a first poll that failed.
  const stale = running && (staleMs !== undefined || snapshot?.status === 'error');
  const statusMessage = snapshot?.error ?? (watcherState === 'error' ? watcherMessage : null);
  const shownError = error ?? statusMessage;

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortAsc((prev) => !prev);
    else {
      setSortKey(key);
      setSortAsc(defaultAscending(key));
    }
  }, [sortKey]);

  const toggleExpanded = useCallback((ifIndex: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ifIndex)) next.delete(ifIndex);
      else next.add(ifIndex);
      return next;
    });
  }, []);

  const th = (key: SortKey, labelKey: string, className?: string) => (
    <th
      className={`itw-th sortable${className ? ` ${className}` : ''}${sortKey === key ? ' sorted' : ''}`}
      onClick={() => handleSort(key)}
      aria-sort={sortKey === key ? (sortAsc ? 'ascending' : 'descending') : 'none'}
      title={t('panes.interfaceTraffic.sortHint')}
    >
      {t(labelKey)}
      {sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  const rateCell = (bps: number | undefined, util: number | undefined, pps: number | undefined, values: (number | undefined)[]) => {
    const hot = util !== undefined && util >= UTIL_WARN_PCT;
    return (
      <div className={`itw-rate${hot ? ' hot' : ''}`} title={`${formatUtil(util)} · ${formatPps(pps)}`}>
        <span className="itw-rate-track">
          {util !== undefined && <span className="itw-rate-fill" style={{ width: `${Math.min(100, util)}%` }} />}
        </span>
        <span className="itw-rate-value">{formatBps(bps)}</span>
        <LineSparkline values={values} slots={30} hot={hot} />
      </div>
    );
  };

  const issuesCell = (row: SnmpIfRow) => {
    const errors = (row.inErrorsDelta ?? 0) + (row.outErrorsDelta ?? 0);
    const discards = (row.inDiscardsDelta ?? 0) + (row.outDiscardsDelta ?? 0);
    const title = t('panes.interfaceTraffic.issuesTitle', {
      errIn: formatCount(row.inErrors),
      errOut: formatCount(row.outErrors),
      discIn: formatCount(row.inDiscards),
      discOut: formatCount(row.outDiscards),
    });
    return (
      <span className="itw-issues" title={title}>
        {errors > 0 && <span className="itw-badge">{t('panes.interfaceTraffic.errorsBadge', { count: errors })}</span>}
        {discards > 0 && <span className="itw-badge">{t('panes.interfaceTraffic.discardsBadge', { count: discards })}</span>}
      </span>
    );
  };

  const showAuthFields = form.version === 'v3' && form.securityLevel !== 'noAuthNoPriv';
  const showPrivFields = form.version === 'v3' && form.securityLevel === 'authPriv';
  const hostShown = form.host.trim();

  const connectForm = (
    <div className="itw-connect-wrap">
      <form
        className="itw-connect"
        onSubmit={(e) => { e.preventDefault(); void handleConnect(); }}
      >
        {devices.length > 0 && (
          <div className="itw-field">
            <span className="itw-field-label">{t('panes.interfaceTraffic.recent')}</span>
            <div className="itw-recent">
              {devices.map((d) => (
                <span key={deviceKey(d)} className={`itw-recent-chip${deviceKey(d) === deviceKey(form) ? ' active' : ''}`}>
                  <button type="button" className="itw-recent-pick" onClick={() => void pickDevice(d)}>
                    {deviceLabel(d)}
                  </button>
                  <button
                    type="button"
                    className="itw-recent-forget"
                    onClick={() => updateSettings('snmpDevices', removeDevice(devices, d))}
                    title={t('panes.interfaceTraffic.forgetDevice', { device: d.host })}
                    aria-label={t('panes.interfaceTraffic.forgetDevice', { device: d.host })}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="itw-field-row">
          <label className="itw-field itw-field-grow">
            <span className="itw-field-label">{t('panes.interfaceTraffic.host')}</span>
            <input
              type="text"
              className="itw-input"
              value={form.host}
              onChange={(e) => updateForm({ host: e.target.value })}
              placeholder="192.0.2.10"
              spellCheck={false}
            />
          </label>
          <label className="itw-field itw-field-port">
            <span className="itw-field-label">{t('panes.interfaceTraffic.port')}</span>
            <input
              type="number"
              className="itw-input"
              value={form.port}
              min={1}
              max={65535}
              onChange={(e) => updateForm({ port: Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="itw-field">
          <span className="itw-field-label">{t('panes.interfaceTraffic.version')}</span>
          <Segmented
            options={VERSION_OPTIONS}
            value={form.version}
            onChange={(v) => updateForm({ version: v })}
            ariaLabel={t('panes.interfaceTraffic.version')}
          />
        </div>

        {form.version === 'v2c' ? (
          <label className="itw-field">
            <span className="itw-field-label">{t('panes.interfaceTraffic.community')}</span>
            <input
              type="password"
              className="itw-input"
              value={community}
              onChange={(e) => setCommunity(e.target.value)}
              autoComplete="off"
            />
          </label>
        ) : (
          <>
            <div className="itw-field-row">
              <label className="itw-field itw-field-grow">
                <span className="itw-field-label">{t('panes.interfaceTraffic.username')}</span>
                <input
                  type="text"
                  className="itw-input"
                  value={form.username}
                  onChange={(e) => updateForm({ username: e.target.value })}
                  autoComplete="off"
                />
              </label>
              <label className="itw-field itw-field-grow">
                <span className="itw-field-label">{t('panes.interfaceTraffic.securityLevel')}</span>
                <select
                  className="itw-input"
                  value={form.securityLevel}
                  onChange={(e) => updateForm({ securityLevel: e.target.value as SnmpSecurityLevel })}
                >
                  <option value="noAuthNoPriv">noAuthNoPriv</option>
                  <option value="authNoPriv">authNoPriv</option>
                  <option value="authPriv">authPriv</option>
                </select>
              </label>
            </div>

            {form.securityLevel === 'noAuthNoPriv' && (
              <p className="itw-hint-warning">{t('panes.interfaceTraffic.noAuthWarning')}</p>
            )}

            {showAuthFields && (
              <div className="itw-field-row">
                <label className="itw-field itw-field-proto">
                  <span className="itw-field-label">{t('panes.interfaceTraffic.authProtocol')}</span>
                  <select
                    className="itw-input"
                    value={form.authProtocol}
                    onChange={(e) => updateForm({ authProtocol: e.target.value as SnmpAuthProtocol })}
                  >
                    {AUTH_PROTOCOLS.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                  </select>
                </label>
                <label className="itw-field itw-field-grow">
                  <span className="itw-field-label">{t('panes.interfaceTraffic.authPassword')}</span>
                  <input
                    type="password"
                    className="itw-input"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </div>
            )}

            {showPrivFields && (
              <div className="itw-field-row">
                <label className="itw-field itw-field-proto">
                  <span className="itw-field-label">{t('panes.interfaceTraffic.privProtocol')}</span>
                  <select
                    className="itw-input"
                    value={form.privProtocol}
                    onChange={(e) => updateForm({ privProtocol: e.target.value as SnmpPrivProtocol })}
                  >
                    {PRIV_PROTOCOLS.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                  </select>
                </label>
                <label className="itw-field itw-field-grow">
                  <span className="itw-field-label">{t('panes.interfaceTraffic.privPassword')}</span>
                  <input
                    type="password"
                    className="itw-input"
                    value={privPassword}
                    onChange={(e) => setPrivPassword(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </div>
            )}

            <label className="itw-field">
              <span className="itw-field-label">{t('panes.interfaceTraffic.contextName')}</span>
              <input
                type="text"
                className="itw-input"
                value={form.contextName}
                onChange={(e) => updateForm({ contextName: e.target.value })}
                placeholder={t('panes.interfaceTraffic.contextPlaceholder')}
              />
            </label>
          </>
        )}

        <label className="itw-checkbox">
          <input
            type="checkbox"
            checked={form.remember}
            onChange={(e) => updateForm({ remember: e.target.checked })}
          />
          {t('panes.interfaceTraffic.rememberSecrets')}
        </label>

        <button type="submit" className="pt-run-btn start itw-connect-btn">
          {t('panes.interfaceTraffic.connect')}
          <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><polygon points="0,0 10,5 0,10" /></svg>
        </button>
      </form>
    </div>
  );

  const statusTone = running ? (stale ? 'waiting' : 'running') : 'stopped';
  const statusLabel = !running
    ? t('panes.interfaceTraffic.stopped')
    : watcherState === 'connecting'
      ? t('panes.interfaceTraffic.connecting')
      : stale
        ? (staleMs !== undefined
          ? t('panes.interfaceTraffic.noReply', { seconds: Math.round(staleMs / 1000) })
          : t('panes.interfaceTraffic.noAnswer'))
        : t('panes.interfaceTraffic.running');

  const lastFreshAt = stale && receivedAt !== null && staleMs !== undefined
    ? new Date(receivedAt - staleMs).toLocaleTimeString()
    : null;

  const monitorView = (
    <>
      <div className="itw-toolbar">
        <span className="itw-toolbar-title">{t('panes.interfaceTraffic.title')}</span>
        <span className="itw-device-name">{snapshot?.sysName ?? hostShown}</span>
        <span className="itw-device-meta">
          {hostShown}:{form.port} · {form.version}
          {snapshot?.sysUptimeSecs !== undefined && ` · ${t('panes.interfaceTraffic.uptime', { uptime: formatUptime(snapshot.sysUptimeSecs) })}`}
        </span>
        <button type="button" className="itw-link-btn" onClick={() => void handleChange()}>
          {t('panes.interfaceTraffic.change')}
        </button>
        {snapshot?.counterWidth === 'legacy' && (
          <span className="itw-legacy-badge" title={t('panes.interfaceTraffic.legacyCounterHelp')}>
            {t('panes.interfaceTraffic.legacyCounter')}
          </span>
        )}
        <span className="itw-toolbar-spacer" />
        <span className="pt-label">{t('panes.interfaceTraffic.interval')}</span>
        <Segmented
          options={INTERVAL_OPTIONS}
          value={form.intervalMs}
          onChange={handleInterval}
          ariaLabel={t('panes.interfaceTraffic.interval')}
        />
        <RunStatus tone={statusTone} label={statusLabel} />
        {lastFreshAt && <span className="itw-last">{t('panes.interfaceTraffic.lastAt', { time: lastFreshAt })}</span>}
        <RunButton
          running={running}
          startLabel={t('panes.interfaceTraffic.start')}
          stopLabel={t('panes.interfaceTraffic.stop')}
          onStart={() => void handleConnect()}
          onStop={() => void handleStop()}
        />
      </div>

      <div className="itw-filter-bar">
        <input
          type="text"
          className="itw-input itw-filter-input"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder={t('panes.interfaceTraffic.filterPlaceholder')}
          aria-label={t('panes.interfaceTraffic.filterPlaceholder')}
        />
        <button
          type="button"
          className={`itw-chip${upOnly ? ' on' : ''}`}
          aria-pressed={upOnly}
          onClick={() => setUpOnly((v) => !v)}
        >
          {t('panes.interfaceTraffic.upOnly')}
        </button>
        <span className="itw-filter-count">
          {t('panes.interfaceTraffic.interfaceCount', { count: visibleRows.length })}
        </span>
      </div>

      {visibleRows.length > 0 ? (
        <div className={`itw-table-wrapper${stale ? ' stale' : ''}`}>
          <table className="itw-table">
            <thead>
              <tr>
                {th('name', 'panes.interfaceTraffic.thInterface')}
                {th('operStatus', 'panes.interfaceTraffic.thStatus')}
                {th('speedMbps', 'panes.interfaceTraffic.thSpeed', 'itw-num')}
                {th('bpsIn', 'panes.interfaceTraffic.thIn')}
                {th('bpsOut', 'panes.interfaceTraffic.thOut')}
                <th className="itw-th">{t('panes.interfaceTraffic.thIssues')}</th>
                <th className="itw-th" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const down = row.operStatus !== undefined && row.operStatus !== 1;
                const open = expanded.has(row.ifIndex);
                const hist: TrafficHistory | undefined = history.get(row.ifIndex);
                const name = row.name ?? row.descr ?? NO_VALUE;
                return (
                  <Fragment key={row.ifIndex}>
                    <tr className={`itw-row${down ? ' down' : ''}${open ? ' open' : ''}`} onClick={() => toggleExpanded(row.ifIndex)}>
                      <td className="itw-td-name" title={row.descr ?? row.name}>
                        <span className="itw-if-name">{name}</span>
                        {row.alias && <span className="itw-if-alias">{row.alias}</span>}
                      </td>
                      <td>
                        <span className={`itw-state ${down ? 'down' : 'up'}`}>
                          <span className="itw-state-dot" />
                          {t(`panes.interfaceTraffic.oper_${operStatusKey(row.operStatus)}`)}
                          {row.adminStatus === 2 && (
                            <span className="itw-admin-down">
                              {' '}({t(`panes.interfaceTraffic.admin_${adminStatusKey(row.adminStatus)}`)})
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="itw-num">{formatSpeed(row.speedMbps)}</td>
                      {measuring ? (
                        <td colSpan={2} className="itw-measuring">
                          {t('panes.interfaceTraffic.measuring', { seconds: nextInSecs })}
                        </td>
                      ) : (
                        <>
                          <td>{rateCell(row.bpsIn, row.utilInPct, row.ppsIn, hist?.bpsIn ?? [])}</td>
                          <td>{rateCell(row.bpsOut, row.utilOutPct, row.ppsOut, hist?.bpsOut ?? [])}</td>
                        </>
                      )}
                      <td>{issuesCell(row)}</td>
                      <td>
                        <button
                          type="button"
                          className={`itw-expand${open ? ' open' : ''}`}
                          aria-expanded={open}
                          aria-label={open ? t('panes.interfaceTraffic.hideGraph', { name }) : t('panes.interfaceTraffic.showGraph', { name })}
                          onClick={(e) => { e.stopPropagation(); toggleExpanded(row.ifIndex); }}
                        >
                          ▸
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="itw-trend-row">
                        <td colSpan={7}>
                          <TrafficTrend history={hist} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="itw-placeholder">
          {rows.length > 0
            ? t('panes.interfaceTraffic.noMatches')
            : running
              ? (snapshot ? t('panes.interfaceTraffic.noAnswer') : t('panes.interfaceTraffic.connecting'))
              : t('panes.interfaceTraffic.stoppedEmpty')}
        </div>
      )}
    </>
  );

  return (
    <div className={`itw-pane${active ? ' active' : ''}`} data-pane-id={paneId}>
      {shownError && <div className="itw-error" role="alert">{shownError}</div>}
      {editing ? connectForm : monitorView}
    </div>
  );
}

function TrafficTrend({ history }: { history: TrafficHistory | undefined }) {
  const { t } = useTranslation();
  const width = 600;
  const height = 64;
  const series = [history?.bpsIn ?? [], history?.bpsOut ?? []];
  const max = Math.max(1, ...series.flat().filter((v): v is number => v !== undefined));
  const step = width / Math.max(1, TRAFFIC_HISTORY - 1);
  const line = (values: (number | undefined)[]) => {
    const offset = TRAFFIC_HISTORY - values.length;
    return values
      .map((v, i) => (v === undefined ? null : `${((offset + i) * step).toFixed(1)},${(height - 2 - (v / max) * (height - 6)).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');
  };
  return (
    <div className="itw-trend">
      <svg className="pt-spark itw-trend-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <line className="pt-spark-axis" x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} />
        <polyline className="pt-spark-line" points={line(series[0])} />
        <polyline className="pt-spark-line second" points={line(series[1])} />
      </svg>
      <div className="itw-trend-legend">
        <span className="itw-trend-key in">{t('panes.interfaceTraffic.thIn')}</span>
        <span className="itw-trend-key out">{t('panes.interfaceTraffic.thOut')}</span>
        <span>{t('panes.interfaceTraffic.trendSpan', { count: TRAFFIC_HISTORY })}</span>
        <span>{t('panes.interfaceTraffic.trendPeak', { value: formatBps(max) })}</span>
      </div>
    </div>
  );
}
