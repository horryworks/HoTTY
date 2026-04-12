import { useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import type { Encoding } from '../../types/appTypes';
import { AppearanceTab } from './AppearanceTab';
import './SettingsModal.css';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'appearance' | 'terminal' | 'connection';

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>('appearance');
  const settings = useSettingsStore();
  const update = settings.update;

  if (!open) return null;

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <span>Settings</span>
        </div>
        <div className="settings-modal-tabs">
          <button
            type="button"
            className={`settings-modal-tab${tab === 'appearance' ? ' active' : ''}`}
            onClick={() => setTab('appearance')}
          >
            Appearance
          </button>
          <button
            type="button"
            className={`settings-modal-tab${tab === 'terminal' ? ' active' : ''}`}
            onClick={() => setTab('terminal')}
          >
            Terminal
          </button>
          <button
            type="button"
            className={`settings-modal-tab${tab === 'connection' ? ' active' : ''}`}
            onClick={() => setTab('connection')}
          >
            Connection
          </button>
        </div>
        <div className="settings-modal-body">
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'terminal' && (
            <>
              <div className="settings-group">
                <label>Scrollback (lines)</label>
                <input
                  type="number"
                  min={100}
                  max={100000}
                  value={settings.scrollback}
                  onChange={(e) => update('scrollback', parseInt(e.target.value, 10) || 10000)}
                />
              </div>
              <div className="settings-group">
                <label>Global encoding</label>
                <div className="settings-radio-row">
                  {(['utf8', 'shift_jis', 'euc-jp'] as Encoding[]).map((enc) => (
                    <label key={enc}>
                      <input
                        type="radio"
                        checked={settings.globalEncoding === enc}
                        onChange={() => update('globalEncoding', enc)}
                      />
                      {enc}
                    </label>
                  ))}
                </div>
              </div>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={settings.lineWrapEnabled}
                  onChange={(e) => update('lineWrapEnabled', e.target.checked)}
                />
                Enable line wrap
              </label>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={settings.backspaceSendsDel}
                  onChange={(e) => update('backspaceSendsDel', e.target.checked)}
                />
                Backspace sends DEL (0x7F)
              </label>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={settings.rightClickPaste}
                  onChange={(e) => update('rightClickPaste', e.target.checked)}
                />
                Right-click to paste
              </label>
            </>
          )}
          {tab === 'connection' && (
            <>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={settings.sshKeepAliveEnabled}
                  onChange={(e) => update('sshKeepAliveEnabled', e.target.checked)}
                />
                SSH keep-alive enabled
              </label>
              <div className="settings-group">
                <label>SSH keep-alive interval (seconds)</label>
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
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={settings.telnetKeepAliveEnabled}
                  onChange={(e) => update('telnetKeepAliveEnabled', e.target.checked)}
                />
                Telnet keep-alive enabled
              </label>
              <div className="settings-group">
                <label>Telnet keep-alive interval (seconds)</label>
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
          )}
        </div>
      </div>
    </div>
  );
}
