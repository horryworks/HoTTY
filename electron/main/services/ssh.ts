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

    disconnect() {
        this.conn.end();
    }
}
