import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import { BrowserWindow } from 'electron';
import * as iconv from 'iconv-lite';
import { ISessionService } from './ISessionService';

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

    connect(config: ConnectConfig & { encoding?: string }) {
        this.encoding = config.encoding || 'utf8';

        this.conn.on('ready', () => {
            this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'connected' });

            this.conn.shell((err, stream) => {
                if (err) {
                    this.window.webContents.send('session-error', { sessionId: this.sessionId, error: err.message });
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
            this.window.webContents.send('session-error', { sessionId: this.sessionId, error: err.message });
        }).on('close', () => {
            this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'disconnected' });
        }).on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
            finish([config.password as string]);
        }).connect({
            ...config,
            tryKeyboard: true,
            algorithms: {
                kex: [
                    "diffie-hellman-group1-sha1",
                    "diffie-hellman-group14-sha1",
                    "ecdh-sha2-nistp256",
                    "ecdh-sha2-nistp384",
                    "ecdh-sha2-nistp521",
                    "diffie-hellman-group-exchange-sha256",
                    "diffie-hellman-group-exchange-sha1"
                ],
                cipher: [
                    "aes128-ctr", "aes192-ctr", "aes256-ctr",
                    "aes128-gcm", "aes128-gcm@openssh.com",
                    "aes256-gcm", "aes256-gcm@openssh.com",
                    "aes128-cbc", "aes192-cbc", "aes256-cbc",
                    "3des-cbc"
                ],
                serverHostKey: [
                    "ssh-rsa", "ssh-dss",
                    "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"
                ],
                hmac: [
                    "hmac-sha2-256", "hmac-sha2-512", "hmac-sha1"
                ]
            }
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
