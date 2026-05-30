import type {
    HostEntry,
    ProtocolId,
    SshConnectionConfig,
    TelnetConnectionConfig,
} from '../../types/appTypes';
import type { AnyConfig } from '../../hooks/useSessionManager';

export function buildHostEntryFromConfig(
    protocol: ProtocolId | null,
    config: AnyConfig | undefined,
): HostEntry | null {
    if (!protocol || !config) return null;
    if (protocol === 'ssh') {
        const c = config as SshConnectionConfig;
        return {
            protocol: 'ssh',
            host: c.host,
            port: c.port,
            username: c.username || undefined,
            password: c.password || undefined,
            privateKeyPath: c.privateKeyPath || undefined,
            privateKeyPassphrase: c.privateKeyPassphrase || undefined,
        };
    }
    if (protocol === 'telnet') {
        const c = config as TelnetConnectionConfig;
        return {
            protocol: 'telnet',
            host: c.host,
            port: c.port,
            username: c.username || undefined,
            password: c.password || undefined,
        };
    }
    return null;
}
