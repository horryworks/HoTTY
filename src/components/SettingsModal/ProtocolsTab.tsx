import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { tauriService } from '../../services/tauriService';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal';
import HelpTooltip from '../HelpTooltip/HelpTooltip';
import type { SshAlgorithms } from '../../types/appTypes';

const CATEGORY_LABELS: Record<string, string> = {
  serverHostKey: 'Server Host Key',
  kex: 'Key Exchange',
  cipher: 'Cipher',
  mac: 'MAC',
};

// diffie-hellman-group-exchange-sha1 is a deprecated KEX (SHA-1 collisions,
// removed by default in OpenSSH 8.2+). Warn before enabling it.
const DH_GEX_NAMES = new Set<string>([
  'diffie-hellman-group-exchange-sha1',
]);

const DH_GEX_WARNING =
  'diffie-hellman-group-exchange-sha1 relies on SHA-1, which is considered ' +
  'broken and was removed from OpenSSH defaults in 8.2. Enable it only if ' +
  'you must talk to legacy devices that offer no stronger key exchange.\n\n' +
  'Prefer diffie-hellman-group-exchange-sha256, diffie-hellman-group14-sha256, ' +
  'or curve25519-sha256 whenever the remote device supports them.\n\n' +
  'Enable diffie-hellman-group-exchange-sha1 anyway?';

export function ProtocolsTab() {
  const settings = useSettingsStore();
  const update = settings.update;

  const [sshAlgorithms, setSshAlgorithms] = useState<SshAlgorithms | null>(null);
  const [pendingDhGex, setPendingDhGex] = useState<{ category: string; name: string } | null>(null);

  useEffect(() => {
    tauriService.getSshAlgorithms().then(setSshAlgorithms).catch(() => {});
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
        <h3 className="settings-section-title settings-section-title--first">SSH</h3>

        <div className="settings-subsection-title">Connect Timeout</div>
        <div className="settings-group">
          <label>Timeout (seconds)</label>
          <input
            type="number"
            min={1}
            max={600}
            value={settings.sshConnectTimeoutSecs}
            onChange={(e) =>
              update('sshConnectTimeoutSecs', parseInt(e.target.value, 10) || 5)
            }
          />
          <HelpTooltip text="Maximum time to wait for the initial TCP and SSH handshake before giving up. Default: 5 seconds." />
        </div>

        <div className="settings-subsection-title">KeepAlive</div>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.sshKeepAliveEnabled}
            onChange={(e) => update('sshKeepAliveEnabled', e.target.checked)}
          />
          Enable
          <HelpTooltip text="Sends dummy packets to prevent timeouts." />
        </label>
        <div className="settings-group">
          <label>Interval (seconds)</label>
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
              Algorithms
              <HelpTooltip text="Choose which algorithms to enable. Changes apply to new sessions." />
            </summary>
            <div className="settings-algorithms-container">
              {Object.keys(sshAlgorithms).map((category) => (
                <div key={category} className="settings-algorithms-category">
                  <h4 className="settings-algorithms-category-title">
                    {CATEGORY_LABELS[category] || category}
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
        <h3 className="settings-section-title">Telnet</h3>

        <div className="settings-subsection-title">Connect Timeout</div>
        <div className="settings-group">
          <label>Timeout (seconds)</label>
          <input
            type="number"
            min={1}
            max={600}
            value={settings.telnetConnectTimeoutSecs}
            onChange={(e) =>
              update('telnetConnectTimeoutSecs', parseInt(e.target.value, 10) || 5)
            }
          />
          <HelpTooltip text="Maximum time to wait for the initial TCP connection before giving up. Default: 5 seconds." />
        </div>

        <div className="settings-subsection-title">KeepAlive</div>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={settings.telnetKeepAliveEnabled}
            onChange={(e) => update('telnetKeepAliveEnabled', e.target.checked)}
          />
          Enable
          <HelpTooltip text="Sends Telnet NOP commands to prevent idle timeouts." />
        </label>
        <div className="settings-group">
          <label>Interval (seconds)</label>
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
          title="Enable diffie-hellman-group-exchange-sha1?"
          message={DH_GEX_WARNING}
          confirmLabel="Enable"
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
