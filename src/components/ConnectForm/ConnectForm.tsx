import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  Encoding,
  ProtocolId,
  SshConnectionConfig,
  TelnetConnectionConfig,
} from '../../types/appTypes';
import { useSettingsStore } from '../../stores/settingsStore';
import './ConnectForm.css';

export interface ConnectSubmitPayload {
  displayName: string;
  protocol: ProtocolId;
  config: SshConnectionConfig | TelnetConnectionConfig;
}

interface ConnectFormProps {
  open: boolean;
  onCancel: () => void;
  onSubmit: (payload: ConnectSubmitPayload) => void;
}

export function ConnectForm({ open: isOpen, onCancel, onSubmit }: ConnectFormProps) {
  const settings = useSettingsStore();
  const [protocol, setProtocol] = useState<ProtocolId>('ssh');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [portEdited, setPortEdited] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState('');
  const [encoding, setEncoding] = useState<Encoding>(settings.globalEncoding);

  const handleProtocolChange = (next: ProtocolId) => {
    setProtocol(next);
    if (!portEdited) {
      setPort(next === 'ssh' ? 22 : 23);
    }
  };

  if (!isOpen) return null;

  const canSubmit =
    host.trim().length > 0 &&
    port > 0 &&
    port <= 65535 &&
    (protocol === 'telnet' || username.trim().length > 0);

  const handleBrowseKey = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      title: 'Select private key file',
    });
    if (typeof selected === 'string') {
      setPrivateKeyPath(selected);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const displayName = `${protocol.toUpperCase()} ${username ? username + '@' : ''}${host}:${port}`;
    if (protocol === 'ssh') {
      const sshKeepAlive = settings.sshKeepAliveEnabled ? settings.sshKeepAliveInterval : 0;
      const config: SshConnectionConfig = {
        host: host.trim(),
        port,
        username: username.trim(),
        password: password || undefined,
        privateKeyPath: privateKeyPath || undefined,
        privateKeyPassphrase: privateKeyPassphrase || undefined,
        encoding,
        keepaliveIntervalSecs: sshKeepAlive,
      };
      onSubmit({ displayName, protocol, config });
    } else {
      const telnetKeepAlive = settings.telnetKeepAliveEnabled
        ? settings.telnetKeepAliveInterval
        : 0;
      const config: TelnetConnectionConfig = {
        host: host.trim(),
        port,
        username: username.trim() || undefined,
        password: password || undefined,
        encoding,
        keepaliveIntervalSecs: telnetKeepAlive,
      };
      onSubmit({ displayName, protocol, config });
    }
  };

  return (
    <div className="connect-form-overlay">
      <form className="connect-form" onSubmit={handleSubmit}>
        <div className="connect-form-header">
          <span>New Connection</span>
        </div>
        <div className="connect-form-body">
          <div className="connect-form-row">
            <label>
              <input
                type="radio"
                checked={protocol === 'ssh'}
                onChange={() => handleProtocolChange('ssh')}
              />
              SSH
            </label>
            <label>
              <input
                type="radio"
                checked={protocol === 'telnet'}
                onChange={() => handleProtocolChange('telnet')}
              />
              Telnet
            </label>
          </div>

          <div className="connect-form-group">
            <label>Host</label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="example.com"
              autoFocus
            />
          </div>

          <div className="connect-form-group">
            <label>Port</label>
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => {
                setPort(parseInt(e.target.value, 10) || 0);
                setPortEdited(true);
              }}
            />
          </div>

          <div className="connect-form-group">
            <label>Username{protocol === 'telnet' ? ' (optional)' : ''}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="connect-form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {protocol === 'ssh' && (
            <>
              <div className="connect-form-group">
                <label>Private Key Path (optional)</label>
                <div className="connect-form-inline">
                  <input
                    type="text"
                    value={privateKeyPath}
                    onChange={(e) => setPrivateKeyPath(e.target.value)}
                    placeholder="~/.ssh/id_rsa"
                  />
                  <button
                    type="button"
                    className="connect-form-btn-secondary"
                    onClick={handleBrowseKey}
                  >
                    Browse…
                  </button>
                </div>
              </div>
              <div className="connect-form-group">
                <label>Private Key Passphrase</label>
                <input
                  type="password"
                  value={privateKeyPassphrase}
                  onChange={(e) => setPrivateKeyPassphrase(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="connect-form-group">
            <label>Encoding</label>
            <select
              value={encoding}
              onChange={(e) => setEncoding(e.target.value as Encoding)}
            >
              <option value="utf8">UTF-8</option>
              <option value="shift_jis">Shift_JIS</option>
              <option value="euc-jp">EUC-JP</option>
            </select>
          </div>
        </div>
        <div className="connect-form-footer">
          <button
            type="button"
            className="connect-form-btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="connect-form-btn-primary"
            disabled={!canSubmit}
          >
            Connect
          </button>
        </div>
      </form>
    </div>
  );
}
