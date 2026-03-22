import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import { BrowserWindow } from 'electron';
import { verifyHostKey } from './knownHosts';
import { logger } from './Logger';

export interface JumpboxConfig {
    host: string;
    port: number;
    username: string;
    password?: string;
}

export interface TunnelResult {
    stream: ClientChannel;
    jumpboxClient: Client;
}

/**
 * Connects to a jumpbox SSH host and opens a TCP tunnel to the target host:port
 * using ssh2's forwardOut(). Returns the tunnel stream that can be used as a
 * socket for the final SSH or Telnet connection.
 */
export function createJumpboxTunnel(
    jumpboxConfig: JumpboxConfig,
    targetHost: string,
    targetPort: number,
    algorithms: ConnectConfig['algorithms'],
    window: BrowserWindow,
): Promise<TunnelResult> {
    return new Promise((resolve, reject) => {
        const jumpboxClient = new Client();

        jumpboxClient.on('ready', () => {
            logger.info('jumpbox', 'Jumpbox connected', { host: jumpboxConfig.host, port: jumpboxConfig.port });
            jumpboxClient.forwardOut(
                '127.0.0.1',
                0,
                targetHost,
                targetPort,
                (err, stream) => {
                    if (err) {
                        logger.error('jumpbox', 'forwardOut failed', { error: err.message });
                        jumpboxClient.end();
                        reject(err);
                        return;
                    }
                    logger.info('jumpbox', 'Tunnel established', { target: `${targetHost}:${targetPort}` });
                    resolve({ stream, jumpboxClient });
                }
            );
        });

        jumpboxClient.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
            finish([jumpboxConfig.password || '']);
        });

        jumpboxClient.on('error', (err) => {
            logger.error('jumpbox', 'Connection error', { host: jumpboxConfig.host, error: err.message });
            reject(err);
        });

        jumpboxClient.connect({
            host: jumpboxConfig.host,
            port: jumpboxConfig.port,
            username: jumpboxConfig.username,
            password: jumpboxConfig.password,
            tryKeyboard: true,
            algorithms,
            hostVerifier: (hostKey: Buffer, verify: (result: boolean) => void) => {
                try {
                    const keyTypeLen = hostKey.readUInt32BE(0);
                    const keyType = hostKey.slice(4, 4 + keyTypeLen).toString('utf8');
                    verifyHostKey(
                        window,
                        jumpboxConfig.host,
                        jumpboxConfig.port,
                        { key: hostKey, type: keyType }
                    ).then((trusted) => {
                        verify(trusted);
                    }).catch((err) => {
                        logger.error('jumpbox', 'Host key verify error', { error: String(err) });
                        verify(false);
                    });
                } catch (err) {
                    logger.error('jumpbox', 'Host key parse error', { error: String(err) });
                    verify(false);
                }
            },
        });
    });
}
