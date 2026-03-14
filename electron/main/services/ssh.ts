import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import { BrowserWindow, app } from 'electron';
import * as iconv from 'iconv-lite';
import * as fs from 'fs';
import * as path from 'path';
import { join } from 'path';
import { ISessionService } from './ISessionService';
import { verifyHostKey } from './knownHosts';

export class SshService implements ISessionService {
    private conn: Client;
    private stream: ClientChannel | null = null;
    private window: BrowserWindow;
    private sessionId: string;
    private encoding: string = 'utf8';

    private lastCols: number | null = null;
    private lastRows: number | null = null;

    constructor(window: BrowserWindow, sessionId: string) {
        this.window = window;
        this.sessionId = sessionId;
        this.conn = new Client();
    }

    setEncoding(encoding: string) {
        this.encoding = encoding;
    }

    private getAlgorithms() {
        // Default algorithms (fallback)
        const defaultAlgorithms = {
            kex: [
                "curve25519-sha256", "curve25519-sha256@libssh.org",
                "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521",
                "diffie-hellman-group-exchange-sha256", "diffie-hellman-group-exchange-sha1",
                "diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1"
            ],
            cipher: [
                "aes128-gcm", "aes128-gcm@openssh.com", "aes256-gcm", "aes256-gcm@openssh.com",
                "aes128-ctr", "aes192-ctr", "aes256-ctr", "aes128-cbc", "aes192-cbc", "aes256-cbc",
                "3des-cbc"
            ],
            serverHostKey: [
                "ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521",
                "rsa-sha2-512", "rsa-sha2-256", "ssh-rsa", "ssh-dss"
            ],
            hmac: [
                "hmac-sha2-256", "hmac-sha2-512", "hmac-sha1"
            ]
        };

        try {
            const configPath = join(app.getPath('userData'), 'ssh_algorithms.json');

            if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf8');
                const config = JSON.parse(content);

                const result: any = {};
                for (const key of ['kex', 'cipher', 'serverHostKey', 'hmac']) {
                    if (config[key] && Array.isArray(config[key])) {
                        result[key] = config[key]
                            .filter((item: any) => item.enabled)
                            .map((item: any) => item.name);
                    }
                }

                // Only return if we actually found enabled algorithms
                if (Object.keys(result).length > 0) {
                    return result;
                }
            }
        } catch (error) {
            console.error('Failed to load SSH algorithms:', error);
        }

        return defaultAlgorithms;
    }

    connect(config: ConnectConfig & { encoding?: string }) {
        this.encoding = config.encoding || 'utf8';

        this.conn.on('ready', () => {
            this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'connected' });

            this.conn.shell((err, stream) => {
                if (err) {
                    console.error('[SSH] Shell channel error:', err);
                    this.window.webContents.send('session-error', { sessionId: this.sessionId, error: 'Failed to open shell channel.' });
                    return;
                }

                this.stream = stream;

                // Apply cached resize if exists
                if (this.lastCols !== null && this.lastRows !== null) {
                    stream.setWindow(this.lastRows, this.lastCols, 0, 0);
                }

                stream.on('close', () => {
                    this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'disconnected' });
                    this.conn.end();
                }).on('data', (data: Buffer) => {
                    const text = iconv.decode(data, this.encoding);
                    this.window.webContents.send('session-data', { sessionId: this.sessionId, data: text });
                    if (this.dataCallback) {
                        this.dataCallback(text);
                    }
                });
            });
        }).on('error', (err) => {
            let message = err.message;
            if (message === 'All configured authentication methods failed') {
                message = 'Username or password may be incorrect';
            }
            this.window.webContents.send('session-error', { sessionId: this.sessionId, error: message });
        }).on('close', () => {
            this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'disconnected' });
        }).on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
            finish([config.password as string]);
        }).connect({
            ...config,
            tryKeyboard: true,
            algorithms: this.getAlgorithms(),
            hostVerifier: (hostKey: Buffer, verify: (result: boolean) => void) => {
                try {
                    // Extract key type from the key buffer (first 4 bytes = length, then key type string)
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
                        console.error('[KnownHosts] hostVerifier error:', err);
                        verify(false);
                    });
                } catch (err) {
                    console.error('[KnownHosts] hostVerifier parse error:', err);
                    verify(false);
                }
            },
        });
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
        this.dataCallback = null;
    }
}
