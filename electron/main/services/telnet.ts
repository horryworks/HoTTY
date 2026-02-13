import { BrowserWindow } from 'electron';
import { Telnet, ConnectOptions } from 'telnet-client';
import * as iconv from 'iconv-lite';
import { ISessionService } from './ISessionService';

export class TelnetService implements ISessionService {
    private conn: Telnet & { socket?: any; opts?: any };
    private window: BrowserWindow;
    private sessionId: string;
    private encoding: string = 'utf8';

    private lastCols: number | null = null;
    private lastRows: number | null = null;

    constructor(window: BrowserWindow, sessionId: string) {
        this.window = window;
        this.sessionId = sessionId;
        this.conn = new Telnet();
    }

    setEncoding(encoding: string) {
        this.encoding = encoding;
    }

    async connect(config: any) {
        this.encoding = config.encoding || 'utf8';

        const params: ConnectOptions = {
            host: config.host,
            port: config.port || 23,
            negotiationMandatory: false, // Revert to false to fix connection issues
            timeout: 3000,
            sendTimeout: 3000,
            disableLogon: true, // Prevent telnet-client from trying to log in
            stripShellPrompt: false, // We want the prompt to be shown in the terminal
            terminalWidth: this.lastCols || 80,
            terminalHeight: this.lastRows || 24,
            irs: '\r\n', // Input Record Separator
            ors: '\r\n', // Output Record Separator
            echoLines: 0 // Don't echo lines locally
        };

        if (config.username) {
            (params as any).username = config.username;
            (params as any).password = config.password || '';
            (params as any).disableLogon = false;
        }

        try {
            await this.conn.connect(params);
            this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'connected' });

            // Apply cached resize if exists
            if (this.lastCols !== null && this.lastRows !== null) {
                this.sendResize(this.lastCols, this.lastRows);

                // Retry resize after a short delay to ensure server is ready for NAWS
                setTimeout(() => {
                    if (this.lastCols !== null && this.lastRows !== null) {
                        this.sendResize(this.lastCols, this.lastRows);
                    }
                }, 500);
            }

            this.conn.on('data', (data: Buffer) => {
                // Manually strip Telnet negotiation sequences if any remain (Double IAC protection)
                // Although 'negotiationMandatory: true' usually handles it, raw dumps might leak.
                // We also decode based on selected encoding.

                const cleanData = this.stripTelnetIAC(data);

                // Decode using iconv-lite
                const text = iconv.decode(cleanData, this.encoding);

                this.window.webContents.send('session-data', { sessionId: this.sessionId, data: text });
            });

            this.conn.on('close', () => {
                this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'disconnected' });
            });

            this.conn.on('error', (err: Error) => {
                this.window.webContents.send('session-error', { sessionId: this.sessionId, error: err.message });
            });

        } catch (err: any) {
            this.window.webContents.send('session-error', { sessionId: this.sessionId, error: err.message || 'Connection failed' });
        }
    }

    /**
     * Telnet IAC (Interpret As Command) シーケンスを手動で除去します。
     *
     * 背景:
     * `negotiationMandatory: false` は telnet-client ライブラリ側のネゴシエーション処理を
     * スキップする設定ですが、リモートサーバーが一方的に送信する IAC シーケンスは
     * data イベントに混入する場合があります。このメソッドはそれらをクリーンに除去し、
     * 純粋なターミナル出力データのみを返します。
     */
    private stripTelnetIAC(data: Buffer): Buffer {
        const IAC = 255;
        const DONT = 254;
        const DO = 253;
        const WONT = 252;
        const WILL = 251;
        const SB = 250;
        const SE = 240;

        let i = 0;
        const clean: number[] = [];

        while (i < data.length) {
            if (data[i] === IAC) {
                // Check next byte
                if (i + 1 >= data.length) break; // Incomplete IAC at end, drop it
                const command = data[i + 1];

                if (command === IAC) {
                    // Escaped IAC (255 255) -> 255
                    clean.push(IAC);
                    i += 2;
                } else if (command === SB) {
                    // Sub-negotiation: IAC SB ... IAC SE
                    // Skip until IAC SE
                    let j = i + 2;
                    while (j < data.length) {
                        if (data[j] === IAC && j + 1 < data.length && data[j + 1] === SE) {
                            j += 2;
                            break;
                        }
                        j++;
                    }
                    i = j;
                } else if (command >= WILL && command <= DONT) {
                    // Command with option: IAC [WILL/WONT/DO/DONT] [OPTION]
                    // Skip 3 bytes
                    i += 3;
                } else {
                    // Other commands: IAC [CMD]
                    // Skip 2 bytes
                    i += 2;
                }
            } else {
                clean.push(data[i]);
                i++;
            }
        }
        return Buffer.from(clean);
    }

    write(data: string) {
        if (this.conn) {
            // Encode data before sending? Usually telnet expects ASCII/UTF8 or raw bytes.
            // If encoding is shift_jis, we should probably encode it.
            // But usually input is simple ASCII.

            // For now, let's assume input matches output encoding requirement or is standard ASCII.
            // If we allow Japanese input, we might need iconv.encode(data, this.encoding).

            // Let's encode it to be safe for Japanese input support
            const buffer = iconv.encode(data, this.encoding);

            // Use socket directly for raw PTY-like input to avoid telnet-client adding newlines
            if (this.conn.socket && typeof this.conn.socket.write === 'function') {
                this.conn.socket.write(buffer);
            } else {
                // Fallback (might not support Buffer sending properly via 'send' in legacy libs but socket usually works)
                this.conn.send(data, { waitfor: false }).catch((err: any) => {
                    console.error('Telnet write error:', err);
                    this.window.webContents.send('session-error', { sessionId: this.sessionId, error: 'Write error: ' + err.message });
                });
            }
        }
    }

    resize(cols: number, rows: number) {
        this.lastCols = cols;
        this.lastRows = rows;

        // Update generic options if available, so re-negotiations use new size
        if (this.conn.opts) {
            this.conn.opts.terminalWidth = cols;
            this.conn.opts.terminalHeight = rows;
        }

        this.sendResize(cols, rows);
    }

    private sendResize(cols: number, rows: number) {
        if (this.conn) {
            try {
                // Send NAWS (Network About Window Size)
                const naws = Buffer.from([
                    255, 250, 31, // IAC SB NAWS
                    (cols >> 8) & 0xFF, cols & 0xFF,
                    (rows >> 8) & 0xFF, rows & 0xFF,
                    255, 240 // IAC SE
                ]);

                // Check for socket and write
                if (this.conn.socket && typeof this.conn.socket.write === 'function') {
                    this.conn.socket.write(naws);
                    // console.log(`[Telnet] Sent resize: ${cols}x${rows}`);
                }
            } catch (e) {
                console.warn('Failed to send telnet resize', e);
            }
        }
    }

    disconnect() {
        if (this.conn) {
            try {
                this.conn.end();
            } catch (e) {
                // ignore
            }
        }
    }
}

