import * as pty from 'node-pty';
import { BrowserWindow } from 'electron';
import * as iconv from 'iconv-lite';
import { ISessionService } from './ISessionService';
import { logger, sanitizeProcessEnv } from './Logger';

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
        logger.info('local', 'Connect attempt', { sessionId: this.sessionId, shell });

        const sanitizedEnv = sanitizeProcessEnv();

        try {
            this.ptyProcess = pty.spawn(shell, [], {
                name: 'xterm-256color',
                cols: 80,
                rows: 24,
                cwd: process.env.HOME || process.env.USERPROFILE,
                env: sanitizedEnv,
                encoding: 'utf8' // Internal PTY encoding
            });

            logger.info('local', 'Connected', { sessionId: this.sessionId });
            this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'connected' });

            this.ptyProcess.onData((data: string) => {
                this.window.webContents.send('session-data', { sessionId: this.sessionId, data });
                if (this.dataCallback) {
                    this.dataCallback(data);
                }
            });

            this.ptyProcess.onExit(({ exitCode, signal }) => {
                logger.info('local', 'Process exited', { sessionId: this.sessionId, exitCode, signal });
                this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'disconnected' });
            });

        } catch (err: any) {
            logger.error('local', 'Spawn error', { sessionId: this.sessionId, error: err.message });
            this.window.webContents.send('session-error', { sessionId: this.sessionId, error: 'Failed to start shell.' });
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
