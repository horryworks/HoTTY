import { BrowserWindow } from 'electron';
import { Telnet, ConnectOptions } from 'telnet-client';
import * as iconv from 'iconv-lite';
import { ISessionService } from './ISessionService';
import { logger } from './Logger';

export class TelnetService implements ISessionService {
    private conn: Telnet & { opts?: { terminalWidth?: number; terminalHeight?: number } };
    private window: BrowserWindow;
    private sessionId: string;
    private encoding: string = 'utf8';

    private lastCols: number | null = null;
    private lastRows: number | null = null;
    private keepaliveTimer: ReturnType<typeof setInterval> | null = null;

    constructor(window: BrowserWindow, sessionId: string) {
        this.window = window;
        this.sessionId = sessionId;
        this.conn = new Telnet();
    }

    setEncoding(encoding: string) {
        this.encoding = encoding;
    }

    async connect(config: Record<string, unknown>) {
        this.encoding = (config.encoding as string) || 'utf8';

        const hasCredentials = !!config.username;

        const params: ConnectOptions = {
            host: config.host as string,
            port: (config.port as number) || 23,
            negotiationMandatory: false, // Revert to false to fix connection issues
            timeout: 3000,
            sendTimeout: 3000,
            stripShellPrompt: false, // We want the prompt to be shown in the terminal
            terminalWidth: this.lastCols || 80,
            terminalHeight: this.lastRows || 24,
            irs: '\r\n', // Input Record Separator
            ors: '\r\n', // Output Record Separator
            echoLines: 0, // Don't echo lines locally
            // Delegate login prompt detection to telnet-client
            disableLogon: !hasCredentials,
            ...(hasCredentials ? {
                username: config.username as string,
                password: (config.password as string) || '',
                loginPrompt: /login[:\s]*$/i,
                passwordPrompt: /password[:\s]*$/i,
            } : {}),
        };

        logger.info('telnet', 'Connect attempt', { sessionId: this.sessionId, host: config.host, port: config.port || 23 });
        try {
            await this.conn.connect(params);
            logger.info('telnet', 'Connected', { sessionId: this.sessionId });
            this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'connected' });

            // Start keepalive if configured
            if (config.telnetKeepAliveInterval && (config.telnetKeepAliveInterval as number) > 0) {
                this.startKeepalive(config.telnetKeepAliveInterval as number);
            }

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
                const cleanData = this.stripTelnetIAC(data);
                const text = iconv.decode(cleanData, this.encoding);

                if (!this.window.isDestroyed()) {
                    this.window.webContents.send('session-data', { sessionId: this.sessionId, data: text });
                }
                if (this.dataCallback) {
                    this.dataCallback(text);
                }
            });

            this.conn.on('close', () => {
                logger.info('telnet', 'Connection closed', { sessionId: this.sessionId });
                if (!this.window.isDestroyed()) {
                    this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'disconnected' });
                }
            });

            this.conn.on('error', (err: Error) => {
                logger.error('telnet', 'Connection error', { sessionId: this.sessionId, error: err.message });
                if (!this.window.isDestroyed()) {
                    this.window.webContents.send('session-error', { sessionId: this.sessionId, error: 'Connection error.' });
                }
            });

        } catch (err: unknown) {
            logger.error('telnet', 'Connect failed', { sessionId: this.sessionId, error: err instanceof Error ? err.message : String(err) });
            this.window.webContents.send('session-error', { sessionId: this.sessionId, error: 'Connection failed.' });
        }
    }

    /**
     * Manually strips Telnet IAC (Interpret As Command) sequences.
     *
     * Background:
     * Although 'negotiationMandatory: false' skips negotiation handling in the
     * telnet-client library, IAC sequences sent by the remote server can still
     * appear in 'data' events. This method cleanly removes them and returns
     * pure terminal output data.
     */
    private stripTelnetIAC(data: Buffer): Buffer {
        const IAC = 255;
        const DONT = 254;
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
                this.conn.send(data, { waitfor: false }).catch((err: unknown) => {
                    logger.error('telnet', 'Write error', { sessionId: this.sessionId, error: err instanceof Error ? err.message : String(err) });
                    this.window.webContents.send('session-error', { sessionId: this.sessionId, error: 'Write error.' });
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
                logger.warn('telnet', 'Failed to send telnet resize', { sessionId: this.sessionId, error: String(e) });
            }
        }
    }

    private dataCallback: ((data: string) => void) | null = null;

    onData(callback: (data: string) => void) {
        this.dataCallback = callback;
    }

    /**
     * Starts keepalive mechanism using both TCP keepalive and Telnet NOP.
     *
     * TCP keepalive maintains OS-level connection health checks.
     * Telnet NOP (IAC NOP = 0xFF 0xF1) resets the server's idle timer,
     * which is the primary cause of Telnet session timeouts.
     */
    private startKeepalive(intervalMs: number) {
        this.stopKeepalive();

        // Enable TCP keepalive on the underlying socket
        if (this.conn.socket && typeof this.conn.socket.setKeepAlive === 'function') {
            this.conn.socket.setKeepAlive(true, intervalMs);
        }

        // Send Telnet NOP (IAC NOP) periodically
        const IAC_NOP = Buffer.from([0xFF, 0xF1]);
        this.keepaliveTimer = setInterval(() => {
            try {
                if (this.conn.socket && typeof this.conn.socket.write === 'function') {
                    this.conn.socket.write(IAC_NOP);
                }
            } catch {
                // Connection may already be closed; stop keepalive
                this.stopKeepalive();
            }
        }, intervalMs);
    }

    private stopKeepalive() {
        if (this.keepaliveTimer) {
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = null;
        }
    }

    disconnect() {
        this.stopKeepalive();
        if (this.conn) {
            try {
                this.conn.end();
            } catch {
                // ignore
            }
        }
        this.dataCallback = null;
    }
}

