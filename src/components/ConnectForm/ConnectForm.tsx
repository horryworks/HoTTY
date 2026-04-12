import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  Encoding,
  ProtocolId,
  SshConnectionConfig,
  TelnetConnectionConfig,
  SerialConnectionConfig,
  WslConnectionConfig,
  LocalConnectionConfig,
  SerialPortInfo,
} from '../../types/appTypes';
import { tauriService } from '../../services/tauriService';
import { useSettingsStore } from '../../stores/settingsStore';
import './ConnectForm.css';

type AnyConfig =
  | SshConnectionConfig
  | TelnetConnectionConfig
  | SerialConnectionConfig
  | WslConnectionConfig
  | LocalConnectionConfig;

export interface ConnectSubmitPayload {
  displayName: string;
  protocol: ProtocolId;
  config: AnyConfig;
}

interface ConnectFormProps {
  open: boolean;
  onCancel: () => void;
  onSubmit: (payload: ConnectSubmitPayload) => void;
}

const PROTOCOL_OPTIONS: { value: ProtocolId; label: string }[] = [
  { value: 'ssh', label: 'SSH' },
  { value: 'telnet', label: 'Telnet' },
  { value: 'serial', label: 'Serial' },
  { value: 'wsl', label: 'WSL' },
  { value: 'cmd', label: 'Command Prompt' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'git-bash', label: 'Git Bash' },
];

const NETWORK_PROTOCOLS = new Set<ProtocolId>(['ssh', 'telnet']);

export function ConnectForm({ open: isOpen, onCancel, onSubmit }: ConnectFormProps) {
  const settings = useSettingsStore();
  // Protocol
  const [protocol, setProtocol] = useState<ProtocolId>('ssh');
  // Network fields (SSH/Telnet)
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [portEdited, setPortEdited] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // SSH-specific
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState('');
  // Serial
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [serialPath, setSerialPath] = useState('');
  const [baudRate, setBaudRate] = useState('9600');
  const [dataBits, setDataBits] = useState('8');
  const [parity, setParity] = useState('none');
  const [stopBits, setStopBits] = useState('1');
  const [flowControl, setFlowControl] = useState('none');
  // WSL
  const [wslDistros, setWslDistros] = useState<string[]>([]);
  const [selectedDistro, setSelectedDistro] = useState('');
  // Git Bash
  const [gitBashPath, setGitBashPath] = useState<string | null>(null);
  // Common
  const [encoding, setEncoding] = useState<Encoding>(settings.globalEncoding);

  // Async data loading per protocol
  useEffect(() => {
    if (!isOpen) return;
    let aborted = false;

    if (protocol === 'serial') {
      tauriService.listSerialPorts().then((ports) => {
        if (aborted) return;
        setSerialPorts(ports);
        if (ports.length > 0 && !serialPath) {
          setSerialPath(ports[0].path);
        }
      }).catch(() => { /* non-fatal */ });
    } else if (protocol === 'wsl') {
      tauriService.listWslDistributions().then((distros) => {
        if (aborted) return;
        setWslDistros(distros);
        if (distros.length > 0 && !selectedDistro) {
          setSelectedDistro(distros[0]);
        }
      }).catch(() => { /* non-fatal */ });
    } else if (protocol === 'git-bash') {
      tauriService.detectGitBash().then((path) => {
        if (aborted) return;
        setGitBashPath(path ?? '');
      }).catch(() => {
        if (!aborted) setGitBashPath('');
      });
    }

    return () => { aborted = true; };
  }, [protocol, isOpen, selectedDistro, serialPath]);

  const handleProtocolChange = (next: ProtocolId) => {
    setProtocol(next);
    if (!portEdited) {
      if (next === 'ssh') setPort(22);
      else if (next === 'telnet') setPort(23);
    }
  };

  if (!isOpen) return null;

  const canSubmit = (() => {
    switch (protocol) {
      case 'ssh':
        return host.trim().length > 0 && port > 0 && port <= 65535 && username.trim().length > 0;
      case 'telnet':
        return host.trim().length > 0 && port > 0 && port <= 65535;
      case 'serial':
        return serialPath.trim().length > 0;
      case 'wsl':
        return selectedDistro.length > 0;
      case 'cmd':
      case 'powershell':
        return true;
      case 'git-bash':
        return gitBashPath !== null && gitBashPath !== '';
    }
  })();

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

  const buildDisplayName = (): string => {
    switch (protocol) {
      case 'ssh':
      case 'telnet': {
        const u = username.trim();
        return `${protocol.toUpperCase()} ${u ? u + '@' : ''}${host.trim()}:${port}`;
      }
      case 'serial':
        return `Serial ${serialPath} (${baudRate})`;
      case 'wsl':
        return `WSL ${selectedDistro}`;
      case 'cmd':
        return 'Command Prompt';
      case 'powershell':
        return 'PowerShell';
      case 'git-bash':
        return 'Git Bash';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const displayName = buildDisplayName();

    switch (protocol) {
      case 'ssh': {
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
        break;
      }
      case 'telnet': {
        const telnetKeepAlive = settings.telnetKeepAliveEnabled ? settings.telnetKeepAliveInterval : 0;
        const config: TelnetConnectionConfig = {
          host: host.trim(),
          port,
          username: username.trim() || undefined,
          password: password || undefined,
          encoding,
          keepaliveIntervalSecs: telnetKeepAlive,
        };
        onSubmit({ displayName, protocol, config });
        break;
      }
      case 'serial': {
        const config: SerialConnectionConfig = {
          path: serialPath.trim(),
          baudRate: parseInt(baudRate, 10),
          dataBits,
          parity,
          stopBits,
          flowControl,
          encoding,
        };
        onSubmit({ displayName, protocol, config });
        break;
      }
      case 'wsl': {
        const config: WslConnectionConfig = {
          distribution: selectedDistro,
          encoding,
        };
        onSubmit({ displayName, protocol, config });
        break;
      }
      case 'cmd':
      case 'powershell':
      case 'git-bash': {
        const config: LocalConnectionConfig = {
          shellType: protocol === 'cmd' ? 'cmd' : protocol === 'powershell' ? 'powershell' : 'git-bash',
          shellPath: protocol === 'git-bash' && gitBashPath ? gitBashPath : undefined,
          encoding,
        };
        onSubmit({ displayName, protocol, config });
        break;
      }
    }
  };

  return (
    <div className="connect-form-overlay">
      <form className="connect-form" onSubmit={handleSubmit}>
        <div className="connect-form-header">
          <span>New Connection</span>
        </div>
        <div className="connect-form-body">
          {/* Protocol selector */}
          <div className="connect-form-group">
            <label>Protocol</label>
            <select
              value={protocol}
              onChange={(e) => handleProtocolChange(e.target.value as ProtocolId)}
            >
              {PROTOCOL_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Network fields (SSH / Telnet) */}
          {NETWORK_PROTOCOLS.has(protocol) && (
            <>
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
            </>
          )}

          {/* SSH-specific fields */}
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

          {/* Serial fields */}
          {protocol === 'serial' && (
            <>
              <div className="connect-form-group">
                <label>Serial Port</label>
                {serialPorts.length > 0 ? (
                  <select value={serialPath} onChange={(e) => setSerialPath(e.target.value)}>
                    {serialPorts.map((p) => (
                      <option key={p.path} value={p.path}>
                        {p.displayName ? `${p.path} (${p.displayName})` : p.path}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={serialPath}
                    onChange={(e) => setSerialPath(e.target.value)}
                    placeholder="COM3"
                    autoFocus
                  />
                )}
              </div>
              <div className="connect-form-two-col">
                <div className="connect-form-group">
                  <label>Baud Rate</label>
                  <select value={baudRate} onChange={(e) => setBaudRate(e.target.value)}>
                    <option value="9600">9600</option>
                    <option value="19200">19200</option>
                    <option value="38400">38400</option>
                    <option value="57600">57600</option>
                    <option value="115200">115200</option>
                  </select>
                </div>
                <div className="connect-form-group">
                  <label>Data Bits</label>
                  <select value={dataBits} onChange={(e) => setDataBits(e.target.value)}>
                    <option value="8">8</option>
                    <option value="7">7</option>
                    <option value="6">6</option>
                    <option value="5">5</option>
                  </select>
                </div>
              </div>
              <div className="connect-form-two-col">
                <div className="connect-form-group">
                  <label>Parity</label>
                  <select value={parity} onChange={(e) => setParity(e.target.value)}>
                    <option value="none">None</option>
                    <option value="odd">Odd</option>
                    <option value="even">Even</option>
                    <option value="mark">Mark</option>
                    <option value="space">Space</option>
                  </select>
                </div>
                <div className="connect-form-group">
                  <label>Stop Bits</label>
                  <select value={stopBits} onChange={(e) => setStopBits(e.target.value)}>
                    <option value="1">1</option>
                    <option value="1.5">1.5</option>
                    <option value="2">2</option>
                  </select>
                </div>
              </div>
              <div className="connect-form-group">
                <label>Flow Control</label>
                <select value={flowControl} onChange={(e) => setFlowControl(e.target.value)}>
                  <option value="none">None</option>
                  <option value="xon/xoff">XON/XOFF</option>
                  <option value="rts/cts">RTS/CTS</option>
                </select>
              </div>
            </>
          )}

          {/* WSL fields */}
          {protocol === 'wsl' && (
            <div className="connect-form-group">
              <label>Distribution</label>
              {wslDistros.length > 0 ? (
                <select value={selectedDistro} onChange={(e) => setSelectedDistro(e.target.value)}>
                  {wslDistros.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              ) : (
                <div className="connect-form-info">
                  No WSL distributions found.
                </div>
              )}
            </div>
          )}

          {/* Git Bash warning */}
          {protocol === 'git-bash' && gitBashPath === '' && (
            <div className="connect-form-warning">
              Git Bash is not installed.
            </div>
          )}

          {/* Encoding — shown for all protocols */}
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
