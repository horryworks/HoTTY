import * as pty from 'node-pty';
import { BrowserWindow } from 'electron';
import * as iconv from 'iconv-lite';
import { ISessionService } from './ISessionService';

export class LocalService implements ISessionService {
    private ptyProcess: pty.IPty | null = null;
    private window: BrowserWindow;
    private sessionId: string;
    private encoding: string = 'utf8';
    private dataCallback: ((data: string) => void) | null = null;

    constructor(window: BrowserWindow, sessionId: string) {
        this.window = window;
        this.sessionId = sessionId;
    }

    setEncoding(encoding: string) {
        this.encoding = encoding;
    }

    onData(callback: (data: string) => void) {
        this.dataCallback = callback;
    }

    connect(config: { shellType: 'cmd' | 'powershell'; encoding?: string }) {
        // With node-pty, we generally use UTF-8 as it handles the translation.
        this.encoding = config.encoding || 'utf8';

        const shell = config.shellType === 'powershell' ? 'powershell.exe' : 'cmd.exe';

        try {
            console.log(`Spawning PTY Local Shell: ${shell}`);
            this.ptyProcess = pty.spawn(shell, [], {
                name: 'xterm-256color',
                cols: 80,
                rows: 24,
                cwd: process.env.HOME || process.env.USERPROFILE,
                env: process.env as any,
                encoding: 'utf8' // Internal PTY encoding
            });

            this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'connected' });

            this.ptyProcess.onData((data: string) => {
                // node-pty handles encoding internally if specified, 
                // but we might need to re-encode if the user requested something specific.
                // For now, assume UTF-8 as node-pty is good at it on Windows.
                this.window.webContents.send('session-data', { sessionId: this.sessionId, data });
                if (this.dataCallback) {
                    this.dataCallback(data);
                }
            });

            this.ptyProcess.onExit(({ exitCode, signal }) => {
                console.log(`Local PTY Process Exited (Session ${this.sessionId}) with code: ${exitCode}, signal: ${signal}`);
                this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'disconnected' });
            });

        } catch (err: any) {
            console.error('PTY Spawn Error:', err);
            this.window.webContents.send('session-error', { sessionId: this.sessionId, error: err.message });
        }
    }

    write(data: string) {
        if (this.ptyProcess) {
            this.ptyProcess.write(data);
        }
    }

    resize(cols: number, rows: number) {
        if (this.ptyProcess) {
            this.ptyProcess.resize(cols, rows);
        }
    }

    disconnect() {
        if (this.ptyProcess) {
            this.ptyProcess.kill();
            this.ptyProcess = null;
        }
    }
}
