import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { tauriService } from '../../services/tauriService';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import HelpTooltip from '../HelpTooltip/HelpTooltip';
import type { SshAlgorithms } from '../../types/appTypes';

// Maps backend algorithm category ids to their translation keys. The displayed
// label is resolved via t() inside the component so it reacts to language.
const CATEGORY_LABEL_KEYS: Record<string, string> = {
  serverHostKey: 'settings.protocols.categoryServerHostKey',
  kex: 'settings.protocols.categoryKex',
  cipher: 'settings.protocols.categoryCipher',
  mac: 'settings.protocols.categoryMac',
};

// diffie-hellman-group-exchange-sha1 is a deprecated KEX (SHA-1 collisions,
// removed by default in OpenSSH 8.2+). Warn before enabling it.
const DH_GEX_NAMES = new Set<string>([
  'diffie-hellman-group-exchange-sha1',
]);

export function ProtocolsTab() {
  const settings = useSettingsStore();
  const update = settings.update;
  const { t } = useTranslation();

  const [sshAlgorithms, setSshAlgorithms] = useState<SshAlgorithms | null>(null);
  const [pendingDhGex, setPendingDhGex] = useState<{ category: string; name: string } | null>(null);

  useEffect(() => {
    tauriService.getSshAlgorithms().then(setSshAlgorithms).catch(() => {});
  }, []);

  // Clear any in-flight warning prompt on unmount so closing the Settings
  // modal mid-confirmation doesn't leave a stale dialog the next time the
  // tab is opened.
  useEffect(() => {
    return () => {
      setPendingDhGex(null);
    };
  }, []);

  const applyAlgorithmToggle = async (category: string, name: string) => {
    if (!sshAlgorithms) return;
    const updated: SshAlgorithms = {
      ...sshAlgorithms,
      [category]: sshAlgorithms[category].map((algo) =>
        algo.name === name ? { ...algo, enabled: !algo.enabled } : algo
      ),
    };
    setSshAlgorithms(updated);
    await tauriService.saveSshAlgorithms(updated);
  };

  const handleAlgorithmToggle = (category: string, name: string) => {
    if (!sshAlgorithms) return;
    const target = sshAlgorithms[category].find((a) => a.name === name);
    if (target && !target.enabled && DH_GEX_NAMES.has(name)) {
      setPendingDhGex({ category, name });
      return;
    }
    void applyAlgorithmToggle(category, name);
  };

  return (
    <>
      {/* ── SSH ── */}
      <div className="settings-card">
        <h3 className="settings-section-title settings-section-title--first">{t('settings.protocols.sshSection')}</h3>

        <div className="settings-subsection-title">{t('settings.protocols.connectTimeout')}</div>
        <div className="settings-group">
          <label>{t('settings.protocols.timeoutSeconds')}</label>
          <input
            type="number"
            min={1}
            max={600}
            value={settings.sshConnectTimeoutSecs}
            onChange={(e) =>
              update('sshConnectTimeoutSecs', parseInt(e.target.value, 10) || 5)
            }
          />
          <HelpTooltip text={t('settings.protocols.sshTimeoutHelp')} />
        </div>

        <div className="settings-subsection-title">{t('settings.protocols.keepAlive')}</div>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.sshKeepAliveEnabled}
            onChange={(e) => update('sshKeepAliveEnabled', e.target.checked)}
          />
          {t('settings.protocols.enable')}
          <HelpTooltip text={t('settings.protocols.sshKeepAliveHelp')} />
        </label>
        <div className="settings-group">
          <label>{t('settings.protocols.intervalSeconds')}</label>
          <input
            type="number"
            min={1}
            max={600}
            value={settings.sshKeepAliveInterval}
            onChange={(e) =>
              update('sshKeepAliveInterval', parseInt(e.target.value, 10) || 10)
            }
            disabled={!settings.sshKeepAliveEnabled}
          />
        </div>

        {/* ── Algorithms ── */}
        {sshAlgorithms && (
          <details className="settings-algorithms-details">
            <summary className="settings-algorithms-summary">
              {t('settings.protocols.algorithms')}
              <HelpTooltip text={t('settings.protocols.algorithmsHelp')} />
            </summary>
            <div className="settings-algorithms-container">
              {Object.keys(sshAlgorithms).map((category) => (
                <div key={category} className="settings-algorithms-category">
                  <h4 className="settings-algorithms-category-title">
                    {CATEGORY_LABEL_KEYS[category] ? t(CATEGORY_LABEL_KEYS[category]) : category}
                  </h4>
                  <div className="settings-algorithms-grid">
                    {sshAlgorithms[category].map((algo) => (
                      <label key={algo.name} className="settings-algorithms-item" title={algo.name}>
                        <input
                          type="checkbox"
                          checked={algo.enabled}
                          onChange={() => handleAlgorithmToggle(category, algo.name)}
                        />
                        <span className="settings-algorithms-name">{algo.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* ── Telnet ── */}
      <div className="settings-card">
        <h3 className="settings-section-title">{t('settings.protocols.telnetSection')}</h3>

        <div className="settings-subsection-title">{t('settings.protocols.connectTimeout')}</div>
        <div className="settings-group">
          <label>{t('settings.protocols.timeoutSeconds')}</label>
          <input
            type="number"
            min={1}
            max={600}
            value={settings.telnetConnectTimeoutSecs}
            onChange={(e) =>
              update('telnetConnectTimeoutSecs', parseInt(e.target.value, 10) || 5)
            }
          />
          <HelpTooltip text={t('settings.protocols.telnetTimeoutHelp')} />
        </div>

        <div className="settings-subsection-title">{t('settings.protocols.keepAlive')}</div>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.telnetKeepAliveEnabled}
            onChange={(e) => update('telnetKeepAliveEnabled', e.target.checked)}
          />
          {t('settings.protocols.enable')}
          <HelpTooltip text={t('settings.protocols.telnetKeepAliveHelp')} />
        </label>
        <div className="settings-group">
          <label>{t('settings.protocols.intervalSeconds')}</label>
          <input
            type="number"
            min={1}
            max={600}
            value={settings.telnetKeepAliveInterval}
            onChange={(e) =>
              update('telnetKeepAliveInterval', parseInt(e.target.value, 10) || 30)
            }
            disabled={!settings.telnetKeepAliveEnabled}
          />
        </div>
      </div>

      {pendingDhGex && (
        <ConfirmModal
          title={t('settings.protocols.dhGexTitle')}
          message={t('settings.protocols.dhGexWarning')}
          confirmLabel={t('settings.protocols.dhGexConfirm')}
          onConfirm={() => {
            const p = pendingDhGex;
            setPendingDhGex(null);
            void applyAlgorithmToggle(p.category, p.name);
          }}
          onCancel={() => setPendingDhGex(null)}
        />
      )}
    </>
  );
}
