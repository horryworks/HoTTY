import { SerialPort } from 'serialport';
import { BrowserWindow } from 'electron';
import * as iconv from 'iconv-lite';
import { ISessionService } from './ISessionService';

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

    async connect(config: SerialConfig) {
        this.encoding = config.encoding || 'utf8';

        const portOptions: any = {
            path: config.path,
            baudRate: config.baudRate || 9600,
            dataBits: config.dataBits || 8,
            parity: config.parity || 'none',
            stopBits: config.stopBits || 1,
            autoOpen: false,
        };

        // Flow control
        if (config.flowControl === 'rts/cts') {
            portOptions.rtscts = true;
        } else if (config.flowControl === 'xon/xoff') {
            portOptions.xon = true;
            portOptions.xoff = true;
        }

        this.port = new SerialPort(portOptions);

        this.port.on('data', (data: Buffer) => {
            const text = iconv.decode(data, this.encoding);
            this.window.webContents.send('session-data', { sessionId: this.sessionId, data: text });
            if (this.dataCallback) {
                this.dataCallback(text);
            }
        });

        this.port.on('error', (err: Error) => {
            this.window.webContents.send('session-error', { sessionId: this.sessionId, error: err.message });
        });

        this.port.on('close', () => {
            this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'disconnected' });
        });

        return new Promise<void>((resolve, reject) => {
            this.port!.open((err) => {
                if (err) {
                    this.window.webContents.send('session-error', { sessionId: this.sessionId, error: `Failed to open ${config.path}: ${err.message}` });
                    reject(err);
                    return;
                }
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
