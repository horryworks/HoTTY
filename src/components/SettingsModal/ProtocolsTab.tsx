import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { tauriService } from '../../services/tauriService';
import HelpTooltip from '../HelpTooltip/HelpTooltip';
import type { SshAlgorithms } from '../../types/appTypes';

const CATEGORY_LABELS: Record<string, string> = {
  serverHostKey: 'Server Host Key',
  kex: 'Key Exchange',
  cipher: 'Cipher',
  mac: 'MAC',
};

export function ProtocolsTab() {
  const settings = useSettingsStore();
  const update = settings.update;

  const [sshAlgorithms, setSshAlgorithms] = useState<SshAlgorithms | null>(null);

  useEffect(() => {
    tauriService.getSshAlgorithms().then(setSshAlgorithms).catch(() => {});
  }, []);

  const handleAlgorithmToggle = async (category: string, name: string) => {
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

  return (
    <>
      {/* ── SSH KeepAlive ── */}
      <h3 className="settings-section-title settings-section-title--first">
        SSH KeepAlive
      </h3>
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

      {/* ── SSH Algorithms ── */}
      {sshAlgorithms && (
        <details className="settings-algorithms-details">
          <summary className="settings-algorithms-summary">
            SSH Algorithms
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

      {/* ── Telnet KeepAlive ── */}
      <h3 className="settings-section-title">Telnet KeepAlive</h3>
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
    </>
  );
}
