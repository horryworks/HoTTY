import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import { BrowserWindow, app } from 'electron';
import * as iconv from 'iconv-lite';
import * as fs from 'fs';
import { join } from 'path';
import { ISessionService } from './ISessionService';
import { verifyHostKey } from './knownHosts';
import { logger } from './Logger';
import { friendlyErrorMessage } from './errorMessages';

// Runtime-supported algorithm lists from ssh2 (filtered by OpenSSL availability)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ssh2Constants = require('ssh2/lib/protocol/constants.js');

export class SshService implements ISessionService {
    private conn: Client;
    private stream: ClientChannel | null = null;
    private window: BrowserWindow;
    private sessionId: string;
    private encoding: string = 'utf8';

    private lastCols: number | null = null;
    private lastRows: number | null = null;

    private tunnelStream: ClientChannel | null = null;
    private jumpboxClient: Client | null = null;

    constructor(window: BrowserWindow, sessionId: string) {
        this.window = window;
        this.sessionId = sessionId;
        this.conn = new Client();
    }

    /** Set a pre-established tunnel stream from a jumpbox connection. */
    setJumpboxTunnel(stream: ClientChannel, jumpboxClient: Client) {
        this.tunnelStream = stream;
        this.jumpboxClient = jumpboxClient;
    }

    setEncoding(encoding: string) {
        this.encoding = encoding;
    }

    getAlgorithms() {
        // Default algorithms (fallback)
        const defaultAlgorithms = {
            kex: [
                "curve25519-sha256", "curve25519-sha256@libssh.org",
                "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521",
                "diffie-hellman-group-exchange-sha256",
                "diffie-hellman-group14-sha256",
                "diffie-hellman-group15-sha512", "diffie-hellman-group16-sha512",
                "diffie-hellman-group17-sha512", "diffie-hellman-group18-sha512",
                "diffie-hellman-group-exchange-sha1",
                "diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1"
            ],
            cipher: [
                "chacha20-poly1305@openssh.com",
                "aes128-gcm", "aes128-gcm@openssh.com", "aes256-gcm", "aes256-gcm@openssh.com",
                "aes128-ctr", "aes192-ctr", "aes256-ctr",
                "aes256-cbc", "aes192-cbc", "aes128-cbc",
                "3des-cbc",
                "arcfour256", "arcfour128", "arcfour",
                "blowfish-cbc", "cast128-cbc"
            ],
            serverHostKey: [
                "ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521",
                "rsa-sha2-512", "rsa-sha2-256", "ssh-rsa", "ssh-dss"
            ],
            hmac: [
                "hmac-sha2-256-etm@openssh.com", "hmac-sha2-512-etm@openssh.com", "hmac-sha1-etm@openssh.com",
                "hmac-sha2-256", "hmac-sha2-512", "hmac-sha1",
                "hmac-md5", "hmac-sha2-256-96", "hmac-sha2-512-96",
                "hmac-ripemd160", "hmac-sha1-96", "hmac-md5-96"
            ]
        };

        // Allowlist of valid algorithm names per category
        const allowedAlgorithms: Record<string, string[]> = defaultAlgorithms;

        // ssh2 runtime-supported algorithms (filtered by OpenSSL/BoringSSL availability)
        const supportedLists: Record<string, string[]> = {
            kex: ssh2Constants.SUPPORTED_KEX,
            cipher: ssh2Constants.SUPPORTED_CIPHER,
            serverHostKey: ssh2Constants.SUPPORTED_SERVER_HOST_KEY,
            hmac: ssh2Constants.SUPPORTED_MAC,
        };

        let algorithms: Record<string, string[]> = defaultAlgorithms;

        try {
            const configPath = join(app.getPath('userData'), 'ssh_algorithms.json');

            if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf8');
                const config = JSON.parse(content);

                const result: Record<string, string[]> = {};
                for (const key of ['kex', 'cipher', 'serverHostKey', 'hmac'] as const) {
                    if (config[key] && Array.isArray(config[key])) {
                        result[key] = config[key]
                            .filter((item: unknown) => typeof item === 'object' && item !== null && (item as Record<string, unknown>).enabled === true)
                            .map((item: unknown) => (item as Record<string, unknown>).name)
                            .filter((name: unknown): name is string => typeof name === 'string' && allowedAlgorithms[key].includes(name));
                    }
                }

                // Only use config if we actually found enabled algorithms
                if (Object.keys(result).length > 0) {
                    algorithms = result;
                }
            }
        } catch (error) {
            logger.error('ssh', 'Failed to load SSH algorithms', { error: String(error) });
        }

        // Filter out algorithms not supported by ssh2 at runtime
        // (e.g. chacha20-poly1305 may be unavailable depending on the OpenSSL/BoringSSL build)
        for (const key of Object.keys(algorithms)) {
            if (supportedLists[key]) {
                const before = algorithms[key];
                algorithms[key] = before.filter(alg => supportedLists[key].includes(alg));
                const removed = before.filter(alg => !supportedLists[key].includes(alg));
                if (removed.length > 0) {
                    logger.warn('ssh', `Filtered unsupported ${key} algorithms`, { removed });
                }
            }
        }

        return algorithms;
    }

    connect(config: ConnectConfig & { encoding?: string; skipHostVerify?: boolean }) {
        this.encoding = config.encoding || 'utf8';
        logger.info('ssh', 'Connect attempt', { sessionId: this.sessionId, host: config.host, port: config.port ?? 22, user: config.username });

        // Capture server-offered algorithms from ssh2 debug output for enriched error messages
        const remoteAlgorithms: Record<string, string> = {};

        this.conn.on('ready', () => {
            logger.info('ssh', 'Connected', { sessionId: this.sessionId });
            this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'connected' });

            this.conn.shell((err, stream) => {
                if (err) {
                    logger.error('ssh', 'Shell channel error', { sessionId: this.sessionId, error: err.message });
                    this.window.webContents.send('session-error', { sessionId: this.sessionId, error: 'Failed to open shell channel.' });
                    return;
                }

                this.stream = stream;

                // Apply cached resize if exists
                if (this.lastCols !== null && this.lastRows !== null) {
                    stream.setWindow(this.lastRows, this.lastCols, 0, 0);
                }

                stream.on('close', () => {
                    logger.info('ssh', 'Shell closed', { sessionId: this.sessionId });
                    if (!this.window.isDestroyed()) {
                        this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'disconnected' });
                    }
                    this.conn.end();
                }).on('data', (data: Buffer) => {
                    const text = iconv.decode(data, this.encoding);
                    if (!this.window.isDestroyed()) {
                        this.window.webContents.send('session-data', { sessionId: this.sessionId, data: text });
                    }
                    if (this.dataCallback) {
                        this.dataCallback(text);
                    }
                });
            });
        }).on('error', (err) => {
            let rawMessage = err.message;
            // Enrich handshake failures with server-offered algorithms
            if (rawMessage.includes('no matching')) {
                const categoryMap: [string, string][] = [
                    ['key exchange', 'KEX method'],
                    ['host key', 'Host key format'],
                    ['C->S cipher', 'C->S cipher'],
                    ['S->C cipher', 'S->C cipher'],
                    ['C->S MAC', 'C->S MAC'],
                    ['S->C MAC', 'S->C MAC'],
                ];
                for (const [errorKey, debugKey] of categoryMap) {
                    if (rawMessage.includes(errorKey) && remoteAlgorithms[debugKey]) {
                        rawMessage += `\nTheir offer: ${remoteAlgorithms[debugKey]}`;
                        break;
                    }
                }
            }
            const message = friendlyErrorMessage(rawMessage);
            logger.error('ssh', 'Connection error', { sessionId: this.sessionId, error: rawMessage });
            if (!this.window.isDestroyed()) {
                this.window.webContents.send('session-error', { sessionId: this.sessionId, error: message });
            }
        }).on('close', () => {
            logger.info('ssh', 'Connection closed', { sessionId: this.sessionId });
            if (!this.window.isDestroyed()) {
                this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'disconnected' });
            }
        }).on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
            finish([config.password as string]);
        });

        // Build connect config — use tunnel stream as socket if jumpbox is configured
        const connectConfig: ConnectConfig & Record<string, unknown> = {
            ...config,
            tryKeyboard: true,
            algorithms: this.getAlgorithms() as ConnectConfig['algorithms'],
            debug: (message: string) => {
                const match = message.match(/^Handshake: \(remote\) (.+?): (.+)$/);
                if (match) {
                    remoteAlgorithms[match[1]] = match[2];
                }
            },
            hostVerifier: (hostKey: Buffer, verify: (result: boolean) => void) => {
                // Skip host key verification for IAP tunnel connections (localhost with dynamic port)
                if (config.skipHostVerify) {
                    verify(true);
                    return;
                }
                try {
                    const keyTypeLen = hostKey.readUInt32BE(0);
                    const keyType = hostKey.slice(4, 4 + keyTypeLen).toString('utf8');
                    verifyHostKey(
                        this.window,
                        config.host as string,
                        (config.port as number) || 22,
                        { key: hostKey, type: keyType }
                    ).then((trusted) => {
                        if (!trusted) {
                            this.window.webContents.send('session-error', {
                                sessionId: this.sessionId,
                                error: 'Connection aborted: Host key not trusted.',
                            });
                        }
                        verify(trusted);
                    }).catch((err) => {
                        logger.error('ssh', 'Host key verify error', { sessionId: this.sessionId, error: String(err) });
                        verify(false);
                    });
                } catch (err) {
                    logger.error('ssh', 'Host key parse error', { sessionId: this.sessionId, error: String(err) });
                    verify(false);
                }
            },
        };

        if (this.tunnelStream) {
            connectConfig.sock = this.tunnelStream;
        }

        try {
            this.conn.connect(connectConfig);
        } catch (err) {
            const message = friendlyErrorMessage(err instanceof Error ? err.message : String(err));
            logger.error('ssh', 'Connect failed', { sessionId: this.sessionId, error: String(err) });
            if (!this.window.isDestroyed()) {
                this.window.webContents.send('session-error', { sessionId: this.sessionId, error: message });
            }
        }
    }

    write(data: string) {
        if (this.stream) {
            const buffer = iconv.encode(data, this.encoding);
            this.stream.write(buffer);
        }
    }

    resize(cols: number, rows: number) {
        this.lastCols = cols;
        this.lastRows = rows;
        if (this.stream) {
            this.stream.setWindow(rows, cols, 0, 0);
        }
    }

    private dataCallback: ((data: string) => void) | null = null;

    onData(callback: (data: string) => void) {
        this.dataCallback = callback;
    }

    disconnect() {
        this.conn.end();
        if (this.jumpboxClient) {
            this.jumpboxClient.end();
            this.jumpboxClient = null;
        }
        this.tunnelStream = null;
        this.dataCallback = null;
    }
}
