import { SerialPort } from 'serialport';
import { BrowserWindow } from 'electron';
import * as iconv from 'iconv-lite';
import { ISessionService } from './ISessionService';
import { logger } from './Logger';

export interface SerialConfig {
    path: string;         // COM port (e.g., 'COM3')
    baudRate: number;     // default: 9600
    dataBits: 5 | 6 | 7 | 8;  // default: 8
    parity: 'none' | 'even' | 'odd' | 'mark' | 'space'; // default: none
    stopBits: 1 | 1.5 | 2; // default: 1
    flowControl: 'none' | 'xon/xoff' | 'rts/cts'; // default: none
    encoding?: string;
}

export class SerialService implements ISessionService {
    private port: SerialPort | null = null;
    private window: BrowserWindow;
    private sessionId: string;
    private encoding: string = 'utf8';

    constructor(window: BrowserWindow, sessionId: string) {
        this.window = window;
        this.sessionId = sessionId;
    }

    setEncoding(encoding: string) {
        this.encoding = encoding;
    }

    async connect(config: Record<string, unknown>) {
        const serialConfig = config as unknown as SerialConfig;
        this.encoding = serialConfig.encoding || 'utf8';
        logger.info('serial', 'Connect attempt', { sessionId: this.sessionId, path: serialConfig.path, baudRate: serialConfig.baudRate });

        // Validate serial port path (Windows: COM1-COM999, Linux/Mac: /dev/tty*)
        const isValidPath = /^COM([1-9]|[1-9]\d|[1-9]\d\d)$/i.test(serialConfig.path) || /^\/dev\/tty[A-Za-z0-9]+$/.test(serialConfig.path);
        if (!isValidPath) {
            logger.warn('serial', 'Invalid port path', { sessionId: this.sessionId, path: serialConfig.path });
            this.window.webContents.send('session-error', { sessionId: this.sessionId, error: 'Invalid serial port path.' });
            return;
        }

        const portOptions: {
            path: string;
            baudRate: number;
            dataBits: number;
            parity: string;
            stopBits: number;
            autoOpen: boolean;
            rtscts?: boolean;
            xon?: boolean;
            xoff?: boolean;
        } = {
            path: serialConfig.path,
            baudRate: serialConfig.baudRate || 9600,
            dataBits: serialConfig.dataBits || 8,
            parity: serialConfig.parity || 'none',
            stopBits: serialConfig.stopBits || 1,
            autoOpen: false,
        };

        // Flow control
        if (serialConfig.flowControl === 'rts/cts') {
            portOptions.rtscts = true;
        } else if (serialConfig.flowControl === 'xon/xoff') {
            portOptions.xon = true;
            portOptions.xoff = true;
        }

        this.port = new SerialPort(portOptions);

        this.port.on('data', (data: Buffer) => {
            const text = iconv.decode(data, this.encoding);
            if (!this.window.isDestroyed()) {
                this.window.webContents.send('session-data', { sessionId: this.sessionId, data: text });
            }
            if (this.dataCallback) {
                this.dataCallback(text);
            }
        });

        this.port.on('error', (err: Error) => {
            logger.error('serial', 'Port error', { sessionId: this.sessionId, error: err.message });
            if (!this.window.isDestroyed()) {
                this.window.webContents.send('session-error', { sessionId: this.sessionId, error: 'Serial port error.' });
            }
        });

        this.port.on('close', () => {
            logger.info('serial', 'Port closed', { sessionId: this.sessionId });
            if (!this.window.isDestroyed()) {
                this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'disconnected' });
            }
        });

        return new Promise<void>((resolve, reject) => {
            this.port!.open((err) => {
                if (err) {
                    logger.error('serial', 'Failed to open port', { sessionId: this.sessionId, path: config.path, error: err.message });
                    this.window.webContents.send('session-error', { sessionId: this.sessionId, error: 'Failed to open serial port.' });
                    reject(err);
                    return;
                }
                logger.info('serial', 'Connected', { sessionId: this.sessionId });
                this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'connected' });
                resolve();
            });
        });
    }

    write(data: string) {
        if (this.port && this.port.isOpen) {
            const buffer = iconv.encode(data, this.encoding);
            this.port.write(buffer);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    resize(_cols: number, _rows: number) {
        // No-op: serial ports have no terminal size concept
    }

    private dataCallback: ((data: string) => void) | null = null;

    onData(callback: (data: string) => void) {
        this.dataCallback = callback;
    }

    disconnect() {
        if (this.port && this.port.isOpen) {
            this.port.close();
        }
        this.dataCallback = null;
    }
}
