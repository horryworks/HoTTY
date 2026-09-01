import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tauriService, isEncrypted } from '../../services/tauriService';
import { useInterfaceTrafficEvents } from '../../hooks/useInterfaceTrafficEvents';
import { useResize } from '../../hooks/useResize';
import { STORAGE_KEYS } from '../../constants/storage';
import { logError } from '../../utils/logger';
import i18n from '../../i18n';
import {
  NO_VALUE,
  adminStatusKey,
  formatBps,
  formatCount,
  formatDelta,
  formatPps,
  formatSpeed,
  formatUtil,
  formatUptime,
  operStatusKey,
} from '../../utils/trafficFormat';
import {
  defaultAscending,
  filterRows,
  sortRows,
  type SortKey,
} from './interfaceTrafficHelpers';
import type {
  SnmpAuthProtocol,
  SnmpConfig,
  SnmpPrivProtocol,
  SnmpSecurityLevel,
  SnmpVersion,
} from '../../types/appTypes';
import './InterfaceTrafficPane.css';

interface InterfaceTrafficPaneProps {
  paneId: string;
  active: boolean;
}

// SNMP polls run the MIB walk on the device's control-plane CPU, so the floor is
// deliberately higher than the Ping Monitor's 1s.
const INTERVAL_OPTIONS = [
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
  { label: '60s', value: 60000 },
];
// 60s by default: a MIB walk is cheap for HoTTY but not for the device's
// control plane, and traffic trends read fine at one-minute granularity. Pick a
// shorter interval per pane when you are actively watching a link.
const DEFAULT_INTERVAL_MS = 60000;

const AUTH_PROTOCOLS: SnmpAuthProtocol[] = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512'];
const PRIV_PROTOCOLS: SnmpPrivProtocol[] = ['des', 'aes128', 'aes192', 'aes256'];

const MIN_PANEL_RATIO = 0.15;
const MAX_PANEL_RATIO = 0.6;
const DEFAULT_PANEL_RATIO = 0.3;

/** Utilization at or above this is highlighted as a saturation warning. */
const UTIL_WARN_PCT = 80;

/** Non-secret settings, persisted per pane. */
interface PersistedForm {
  host: string;
  port: number;
  version: SnmpVersion;
  username: string;
  securityLevel: SnmpSecurityLevel;
  authProtocol: SnmpAuthProtocol;
  privProtocol: SnmpPrivProtocol;
  contextName: string;
  intervalMs: number;
  remember: boolean;
  /** Only written when `remember` is on; always DPAPI-encrypted (`[SAFE]`). */
  community?: string;
  authPassword?: string;
  privPassword?: string;
}

const DEFAULT_FORM: PersistedForm = {
  host: '',
  port: 161,
  version: 'v2c',
  username: '',
  securityLevel: 'authPriv',
  authProtocol: 'sha256',
  privProtocol: 'aes128',
  contextName: '',
  intervalMs: DEFAULT_INTERVAL_MS,
  remember: false,
};

function formatIntervalLabel(ms: number): string {
  return INTERVAL_OPTIONS.find((o) => o.value === ms)?.label ?? `${ms / 1000}s`;
}

export function InterfaceTrafficPane({ paneId, active }: InterfaceTrafficPaneProps) {
  const { t } = useTranslation();

  const [form, setForm] = useState<PersistedForm>(DEFAULT_FORM);
  const [community, setCommunity] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [privPassword, setPrivPassword] = useState('');

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverInfo, setDiscoverInfo] = useState<string | null>(null);

  const [filterQuery, setFilterQuery] = useState('');
  const [upOnly, setUpOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('ifIndex');
  const [sortAsc, setSortAsc] = useState(true);

  const [panelRatio, setPanelRatio] = useState(DEFAULT_PANEL_RATIO);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const ratioBeforeCollapse = useRef(DEFAULT_PANEL_RATIO);

  const { snapshot, watcherState, watcherMessage } = useInterfaceTrafficEvents(paneId);

  // Restore this pane's saved settings. Secrets are only present if the user
  // ticked "remember", and arrive DPAPI-encrypted.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const raw = localStorage.getItem(STORAGE_KEYS.SNMP_TARGET(paneId));
      if (!raw) return;
      const saved = { ...DEFAULT_FORM, ...(JSON.parse(raw) as Partial<PersistedForm>) };
      if (cancelled) return;
      setForm({ ...saved, community: undefined, authPassword: undefined, privPassword: undefined });

      if (!saved.remember) return;
      const decrypt = async (value?: string) => {
        if (!value) return '';
        return isEncrypted(value) ? await tauriService.dpapiDecrypt(value) : value;
      };
      const [c, a, p] = await Promise.all([
        decrypt(saved.community),
        decrypt(saved.authPassword),
        decrypt(saved.privPassword),
      ]);
      if (cancelled) return;
      setCommunity(c);
      setAuthPassword(a);
      setPrivPassword(p);
    };
    load().catch((e) => logError('InterfaceTraffic', i18n.t('notifications.errors.trafficSettingsRestore'), e));
    return () => {
      cancelled = true;
    };
  }, [paneId]);

  const persist = useCallback(
    async (next: PersistedForm, secrets: { community: string; auth: string; priv: string }) => {
      const payload: PersistedForm = { ...next };
      if (next.remember) {
        const encrypt = async (value: string) =>
          value ? await tauriService.dpapiEncrypt(value) : undefined;
        payload.community = await encrypt(secrets.community);
        payload.authPassword = await encrypt(secrets.auth);
        payload.privPassword = await encrypt(secrets.priv);
      } else {
        delete payload.community;
        delete payload.authPassword;
        delete payload.privPassword;
      }
      localStorage.setItem(STORAGE_KEYS.SNMP_TARGET(paneId), JSON.stringify(payload));
    },
    [paneId]
  );

  const updateForm = useCallback((patch: Partial<PersistedForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const { startResize } = useResize({
    orientation: 'horizontal',
    onMove: (dx) => {
      setPanelRatio((prev) => {
        const bodyW = bodyRef.current?.clientWidth ?? 600;
        return Math.max(MIN_PANEL_RATIO, Math.min(MAX_PANEL_RATIO, prev + dx / bodyW));
      });
    },
  });

  const toggleCollapse = useCallback(() => {
    setPanelCollapsed((prev) => {
      if (!prev) ratioBeforeCollapse.current = panelRatio;
      else setPanelRatio(ratioBeforeCollapse.current);
      return !prev;
    });
  }, [panelRatio]);

  const buildConfig = useCallback((): SnmpConfig => {
    const base: SnmpConfig = {
      host: form.host.trim(),
      port: form.port,
      version: form.version,
    };
    if (form.version === 'v2c') {
      return { ...base, community };
    }
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

  const handleStart = useCallback(async () => {
    if (!form.host.trim()) {
      setError(t('panes.interfaceTraffic.errorNoHost'));
      return;
    }
    setError(null);
    try {
      await tauriService.snmpWatcherStart(paneId, buildConfig(), form.intervalMs);
      setRunning(true);
      await persist(form, { community, auth: authPassword, priv: privPassword });
    } catch (e) {
      setError(String(e));
    }
  }, [paneId, form, buildConfig, persist, community, authPassword, privPassword, t]);

  const handleStop = useCallback(async () => {
    try {
      await tauriService.snmpWatcherStop(paneId);
      setRunning(false);
    } catch (e) {
      setError(String(e));
    }
  }, [paneId]);

  const handleUpdateInterval = useCallback(
    async (newMs: number) => {
      updateForm({ intervalMs: newMs });
      if (running) {
        try {
          await tauriService.snmpWatcherUpdateInterval(paneId, newMs);
        } catch (e) {
          setError(String(e));
        }
      }
    },
    [paneId, running, updateForm]
  );

  const handleDiscover = useCallback(async () => {
    if (!form.host.trim()) {
      setError(t('panes.interfaceTraffic.errorNoHost'));
      return;
    }
    setError(null);
    setDiscoverInfo(null);
    setDiscovering(true);
    try {
      const result = await tauriService.snmpListInterfaces(buildConfig());
      setDiscoverInfo(
        t('panes.interfaceTraffic.discoverResult', {
          count: result.interfaces.length,
          device: result.sysName ?? form.host.trim(),
        })
      );
      await persist(form, { community, auth: authPassword, priv: privPassword });
    } catch (e) {
      setError(String(e));
    } finally {
      setDiscovering(false);
    }
  }, [form, buildConfig, persist, community, authPassword, privPassword, t]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) setSortAsc((prev) => !prev);
      else {
        setSortKey(key);
        setSortAsc(defaultAscending(key));
      }
    },
    [sortKey]
  );

  // Memoised so the `?? []` fallback doesn't hand `useMemo` a fresh array — and
  // therefore a re-sort of the whole table — on every render.
  const rows = useMemo(() => snapshot?.interfaces ?? [], [snapshot]);
  const visibleRows = useMemo(
    () => sortRows(filterRows(rows, filterQuery, upOnly), sortKey, sortAsc),
    [rows, filterQuery, upOnly, sortKey, sortAsc]
  );

  const isStale = snapshot?.status === 'error';
  const statusMessage = snapshot?.error ?? (watcherState === 'error' ? watcherMessage : null);

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '');
  const th = (key: SortKey, labelKey: string, className?: string) => (
    <th
      className={`itw-th${className ? ` ${className}` : ''}${sortKey === key ? ' sorted' : ''}`}
      onClick={() => handleSort(key)}
      role="columnheader"
      aria-sort={sortKey === key ? (sortAsc ? 'ascending' : 'descending') : 'none'}
      title={t('panes.interfaceTraffic.sortHint')}
    >
      {t(labelKey)}
      {sortIndicator(key)}
    </th>
  );

  const showAuthFields = form.version === 'v3' && form.securityLevel !== 'noAuthNoPriv';
  const showPrivFields = form.version === 'v3' && form.securityLevel === 'authPriv';

  return (
    <div className={`itw-pane${active ? ' active' : ''}`} data-pane-id={paneId}>
      <div className="itw-toolbar">
        <span className="itw-toolbar-title">{t('panes.interfaceTraffic.title')}</span>
        {form.host && (
          <span className="itw-toolbar-target" title={`${form.host}:${form.port}`}>
            {form.host}:{form.port} · {form.version}
          </span>
        )}
        {snapshot?.counterWidth === 'legacy' && (
          <span className="itw-legacy-badge" title={t('panes.interfaceTraffic.legacyCounterHelp')}>
            {t('panes.interfaceTraffic.legacyCounter')}
          </span>
        )}
        <span className="itw-toolbar-spacer" />
        <label className="itw-interval-label">
          {t('panes.interfaceTraffic.intervalLabel')}
          <select
            className="itw-interval-select"
            value={form.intervalMs}
            onChange={(e) => handleUpdateInterval(Number(e.target.value))}
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <button type="button" className="itw-toolbar-btn itw-btn-stop" onClick={handleStop}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect width="10" height="10" rx="1" /></svg>
            {t('panes.interfaceTraffic.stop')}
          </button>
        ) : (
          <button type="button" className="itw-toolbar-btn itw-btn-start" onClick={handleStart}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="0,0 10,5 0,10" /></svg>
            {t('panes.interfaceTraffic.start')}
          </button>
        )}
      </div>

      {error && <div className="itw-error" role="alert">{error}</div>}

      <div className="itw-body" ref={bodyRef}>
        {!panelCollapsed && (
          <div className="itw-config-panel" style={{ width: `${panelRatio * 100}%` }}>
            <div className="itw-config-scroll">
              <div className="itw-field-row">
                <label className="itw-field itw-field-grow">
                  <span className="itw-field-label">{t('panes.interfaceTraffic.host')}</span>
                  <input
                    type="text"
                    className="itw-input"
                    value={form.host}
                    onChange={(e) => updateForm({ host: e.target.value })}
                    placeholder="192.0.2.10"
                    disabled={running}
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
                    disabled={running}
                  />
                </label>
              </div>

              <label className="itw-field">
                <span className="itw-field-label">{t('panes.interfaceTraffic.version')}</span>
                <select
                  className="itw-input"
                  value={form.version}
                  onChange={(e) => updateForm({ version: e.target.value as SnmpVersion })}
                  disabled={running}
                >
                  <option value="v2c">SNMPv2c</option>
                  <option value="v3">SNMPv3</option>
                </select>
              </label>

              {form.version === 'v2c' ? (
                <label className="itw-field">
                  <span className="itw-field-label">{t('panes.interfaceTraffic.community')}</span>
                  <input
                    type="password"
                    className="itw-input"
                    value={community}
                    onChange={(e) => setCommunity(e.target.value)}
                    autoComplete="off"
                    disabled={running}
                  />
                </label>
              ) : (
                <>
                  <label className="itw-field">
                    <span className="itw-field-label">{t('panes.interfaceTraffic.username')}</span>
                    <input
                      type="text"
                      className="itw-input"
                      value={form.username}
                      onChange={(e) => updateForm({ username: e.target.value })}
                      autoComplete="off"
                      disabled={running}
                    />
                  </label>

                  <label className="itw-field">
                    <span className="itw-field-label">{t('panes.interfaceTraffic.securityLevel')}</span>
                    <select
                      className="itw-input"
                      value={form.securityLevel}
                      onChange={(e) =>
                        updateForm({ securityLevel: e.target.value as SnmpSecurityLevel })
                      }
                      disabled={running}
                    >
                      <option value="noAuthNoPriv">noAuthNoPriv</option>
                      <option value="authNoPriv">authNoPriv</option>
                      <option value="authPriv">authPriv</option>
                    </select>
                  </label>

                  {form.securityLevel === 'noAuthNoPriv' && (
                    <p className="itw-hint itw-hint-warning">
                      {t('panes.interfaceTraffic.noAuthWarning')}
                    </p>
                  )}

                  {showAuthFields && (
                    <>
                      <label className="itw-field">
                        <span className="itw-field-label">{t('panes.interfaceTraffic.authProtocol')}</span>
                        <select
                          className="itw-input"
                          value={form.authProtocol}
                          onChange={(e) =>
                            updateForm({ authProtocol: e.target.value as SnmpAuthProtocol })
                          }
                          disabled={running}
                        >
                          {AUTH_PROTOCOLS.map((p) => (
                            <option key={p} value={p}>{p.toUpperCase()}</option>
                          ))}
                        </select>
                      </label>
                      <label className="itw-field">
                        <span className="itw-field-label">{t('panes.interfaceTraffic.authPassword')}</span>
                        <input
                          type="password"
                          className="itw-input"
                          value={authPassword}
                          onChange={(e) => setAuthPassword(e.target.value)}
                          autoComplete="off"
                          disabled={running}
                        />
                      </label>
                    </>
                  )}

                  {showPrivFields && (
                    <>
                      <label className="itw-field">
                        <span className="itw-field-label">{t('panes.interfaceTraffic.privProtocol')}</span>
                        <select
                          className="itw-input"
                          value={form.privProtocol}
                          onChange={(e) =>
                            updateForm({ privProtocol: e.target.value as SnmpPrivProtocol })
                          }
                          disabled={running}
                        >
                          {PRIV_PROTOCOLS.map((p) => (
                            <option key={p} value={p}>{p.toUpperCase()}</option>
                          ))}
                        </select>
                      </label>
                      <label className="itw-field">
                        <span className="itw-field-label">{t('panes.interfaceTraffic.privPassword')}</span>
                        <input
                          type="password"
                          className="itw-input"
                          value={privPassword}
                          onChange={(e) => setPrivPassword(e.target.value)}
                          autoComplete="off"
                          disabled={running}
                        />
                      </label>
                    </>
                  )}

                  <label className="itw-field">
                    <span className="itw-field-label">{t('panes.interfaceTraffic.contextName')}</span>
                    <input
                      type="text"
                      className="itw-input"
                      value={form.contextName}
                      onChange={(e) => updateForm({ contextName: e.target.value })}
                      placeholder={t('panes.interfaceTraffic.contextPlaceholder')}
                      disabled={running}
                    />
                  </label>
                </>
              )}

              <label className="itw-checkbox">
                <input
                  type="checkbox"
                  checked={form.remember}
                  onChange={(e) => updateForm({ remember: e.target.checked })}
                  disabled={running}
                />
                {t('panes.interfaceTraffic.remember')}
              </label>
              <p className="itw-hint">{t('panes.interfaceTraffic.rememberHelp')}</p>

              <button
                type="button"
                className="itw-discover-btn"
                onClick={handleDiscover}
                disabled={discovering || running}
              >
                {discovering
                  ? t('panes.interfaceTraffic.discovering')
                  : t('panes.interfaceTraffic.discover')}
              </button>
              {discoverInfo && <p className="itw-hint itw-hint-ok">{discoverInfo}</p>}
            </div>
          </div>
        )}

        <div className="itw-divider">
          <div className="itw-divider-handle" onMouseDown={startResize} />
          <button
            type="button"
            className={`itw-divider-toggle${panelCollapsed ? ' collapsed' : ''}`}
            onClick={toggleCollapse}
            title={
              panelCollapsed
                ? t('panes.interfaceTraffic.showConfigPanel')
                : t('panes.interfaceTraffic.hideConfigPanel')
            }
          >
            <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
              <path d={panelCollapsed ? 'M2 0l6 6-6 6z' : 'M6 0L0 6l6 6z'} />
            </svg>
          </button>
        </div>

        <div className="itw-results-panel">
          <div className="itw-filter-bar">
            <input
              type="text"
              className="itw-input itw-filter-input"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t('panes.interfaceTraffic.filterPlaceholder')}
              aria-label={t('panes.interfaceTraffic.filterPlaceholder')}
            />
            <label className="itw-checkbox itw-checkbox-inline">
              <input type="checkbox" checked={upOnly} onChange={(e) => setUpOnly(e.target.checked)} />
              {t('panes.interfaceTraffic.upOnly')}
            </label>
            <span className="itw-filter-count">
              {t('panes.interfaceTraffic.interfaceCount', { count: visibleRows.length })}
            </span>
          </div>

          {visibleRows.length > 0 ? (
            <div className={`itw-table-wrapper${isStale ? ' stale' : ''}`}>
              <table className="itw-table">
                <thead>
                  <tr>
                    {th('ifIndex', 'panes.interfaceTraffic.thIndex', 'itw-th-num')}
                    {th('name', 'panes.interfaceTraffic.thInterface')}
                    {th('alias', 'panes.interfaceTraffic.thAlias')}
                    {th('operStatus', 'panes.interfaceTraffic.thStatus')}
                    {th('speedMbps', 'panes.interfaceTraffic.thSpeed', 'itw-th-num')}
                    {th('bpsIn', 'panes.interfaceTraffic.thBpsIn', 'itw-th-num')}
                    {th('bpsOut', 'panes.interfaceTraffic.thBpsOut', 'itw-th-num')}
                    {th('ppsIn', 'panes.interfaceTraffic.thPpsIn', 'itw-th-num')}
                    {th('ppsOut', 'panes.interfaceTraffic.thPpsOut', 'itw-th-num')}
                    {th('inErrors', 'panes.interfaceTraffic.thInErrors', 'itw-th-num')}
                    {th('outErrors', 'panes.interfaceTraffic.thOutErrors', 'itw-th-num')}
                    {th('inDiscards', 'panes.interfaceTraffic.thInDiscards', 'itw-th-num')}
                    {th('outDiscards', 'panes.interfaceTraffic.thOutDiscards', 'itw-th-num')}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const down = row.operStatus !== undefined && row.operStatus !== 1;
                    const utilIn = row.utilInPct;
                    const utilOut = row.utilOutPct;
                    return (
                      <tr key={row.ifIndex} className={`itw-row${down ? ' itw-row-down' : ''}`}>
                        <td className="itw-td-num">{row.ifIndex}</td>
                        <td className="itw-td-name" title={row.descr ?? row.name}>
                          {row.name ?? row.descr ?? NO_VALUE}
                        </td>
                        <td className="itw-td-alias" title={row.alias}>{row.alias ?? NO_VALUE}</td>
                        <td className="itw-td-status">
                          {t(`panes.interfaceTraffic.oper_${operStatusKey(row.operStatus)}`)}
                          {row.adminStatus === 2 && (
                            <span className="itw-admin-down">
                              {' '}
                              ({t(`panes.interfaceTraffic.admin_${adminStatusKey(row.adminStatus)}`)})
                            </span>
                          )}
                        </td>
                        <td className="itw-td-num">{formatSpeed(row.speedMbps)}</td>
                        <td className={`itw-td-num${utilIn !== undefined && utilIn >= UTIL_WARN_PCT ? ' itw-warn' : ''}`}>
                          {formatBps(row.bpsIn)}
                          {utilIn !== undefined && (
                            <span className="itw-util"> ({formatUtil(utilIn)})</span>
                          )}
                        </td>
                        <td className={`itw-td-num${utilOut !== undefined && utilOut >= UTIL_WARN_PCT ? ' itw-warn' : ''}`}>
                          {formatBps(row.bpsOut)}
                          {utilOut !== undefined && (
                            <span className="itw-util"> ({formatUtil(utilOut)})</span>
                          )}
                        </td>
                        <td className="itw-td-num">{formatPps(row.ppsIn)}</td>
                        <td className="itw-td-num">{formatPps(row.ppsOut)}</td>
                        <td className={`itw-td-num${row.inErrorsDelta ? ' itw-warn' : ''}`}>
                          {formatCount(row.inErrors)}
                          <span className="itw-delta"> {formatDelta(row.inErrorsDelta)}</span>
                        </td>
                        <td className={`itw-td-num${row.outErrorsDelta ? ' itw-warn' : ''}`}>
                          {formatCount(row.outErrors)}
                          <span className="itw-delta"> {formatDelta(row.outErrorsDelta)}</span>
                        </td>
                        <td className={`itw-td-num${row.inDiscardsDelta ? ' itw-warn' : ''}`}>
                          {formatCount(row.inDiscards)}
                          <span className="itw-delta"> {formatDelta(row.inDiscardsDelta)}</span>
                        </td>
                        <td className={`itw-td-num${row.outDiscardsDelta ? ' itw-warn' : ''}`}>
                          {formatCount(row.outDiscards)}
                          <span className="itw-delta"> {formatDelta(row.outDiscardsDelta)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="itw-placeholder">
              {running
                ? watcherState === 'connecting'
                  ? t('panes.interfaceTraffic.connecting')
                  : rows.length > 0
                    ? t('panes.interfaceTraffic.noMatches')
                    : t('panes.interfaceTraffic.measuring')
                : t('panes.interfaceTraffic.enterTarget')}
            </div>
          )}
        </div>
      </div>

      <div className="itw-statusbar">
        <span className={`itw-status-dot ${running ? (isStale ? 'error' : 'running') : 'stopped'}`} />
        <span className="itw-status-label">
          {running
            ? t('panes.interfaceTraffic.statusRunning')
            : t('panes.interfaceTraffic.statusStopped')}
        </span>
        <span className="itw-status-info">
          {t('panes.interfaceTraffic.statusInterval', {
            interval: formatIntervalLabel(snapshot?.intervalMs ?? form.intervalMs),
          })}
        </span>
        {snapshot && (
          <span className="itw-status-info">
            {t('panes.interfaceTraffic.statusPollMs', { ms: snapshot.pollMs })}
          </span>
        )}
        {snapshot?.sysName && <span className="itw-status-info">{snapshot.sysName}</span>}
        {snapshot?.sysUptimeSecs !== undefined && (
          <span className="itw-status-info">
            {t('panes.interfaceTraffic.statusUptime', {
              uptime: formatUptime(snapshot.sysUptimeSecs),
            })}
          </span>
        )}
        {snapshot?.staleForMs !== undefined && (
          <span className="itw-status-stale">
            {t('panes.interfaceTraffic.statusStale', {
              seconds: Math.round(snapshot.staleForMs / 1000),
            })}
          </span>
        )}
        {statusMessage && <span className="itw-status-error">{statusMessage}</span>}
      </div>
    </div>
  );
}
