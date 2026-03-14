import * as pty from 'node-pty';
import { BrowserWindow } from 'electron';
import { ISessionService } from './ISessionService';

export class WslService implements ISessionService {
    private ptyProcess: pty.IPty | null = null;
    private window: BrowserWindow;
    private sessionId: string;
    private dataCallback: ((data: string) => void) | null = null;

    constructor(window: BrowserWindow, sessionId: string) {
        this.window = window;
        this.sessionId = sessionId;
    }

    setEncoding(encoding: string) {
        // node-pty handles encoding internally, but we satisfy the interface
    }

    onData(callback: (data: string) => void) {
        this.dataCallback = callback;
    }

    connect(config: { distro?: string }) {
        const distro = config.distro?.trim();
        if (distro && !/^[\w][\w\-.]{0,62}$/.test(distro)) {
            this.window.webContents.send('session-error', { sessionId: this.sessionId, error: 'Invalid WSL distribution name' });
            return;
        }
        const args = distro ? ['-d', distro] : [];

        try {
            console.log(`Spawning WSL PTY: wsl.exe ${distro ? `-d ${distro}` : '(default)'}`);
            this.ptyProcess = pty.spawn('wsl.exe', args, {
                name: 'xterm-256color',
                cols: 80,
                rows: 24,
                cwd: process.env.HOME || process.env.USERPROFILE,
                env: process.env as any,
                encoding: 'utf8'
            });

            this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'connected' });

            this.ptyProcess.onData((data: string) => {
                this.window.webContents.send('session-data', { sessionId: this.sessionId, data });
                if (this.dataCallback) {
                    this.dataCallback(data);
                }
            });

            this.ptyProcess.onExit(({ exitCode, signal }) => {
                console.log(`WSL PTY Process Exited (Session ${this.sessionId}) with code: ${exitCode}, signal: ${signal}`);
                this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'disconnected' });
            });

        } catch (err: any) {
            console.error('WSL PTY Spawn Error:', err);
            this.window.webContents.send('session-error', { sessionId: this.sessionId, error: 'Failed to start WSL.' });
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
