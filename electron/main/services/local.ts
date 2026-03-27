import * as pty from 'node-pty';
import * as path from 'path';
import * as fs from 'fs';
import { BrowserWindow } from 'electron';
import { ISessionService } from './ISessionService';
import { logger, sanitizeProcessEnv } from './Logger';

const GIT_BASH_CANDIDATES = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
];

export function detectGitBash(): { available: boolean; path?: string } {
    for (const candidate of GIT_BASH_CANDIDATES) {
        const resolved = path.resolve(candidate);
        if (fs.existsSync(resolved)) {
            return { available: true, path: resolved };
        }
    }
    // Fallback: check if git is on PATH and derive bash.exe location
    const gitPath = process.env.PATH?.split(path.delimiter)
        .map(dir => path.resolve(dir, 'git.exe'))
        .find(p => fs.existsSync(p));
    if (gitPath) {
        // git.exe is typically in Git/cmd/git.exe, bash.exe is in Git/bin/bash.exe
        const gitBinBash = path.resolve(path.dirname(gitPath), '..', 'bin', 'bash.exe');
        if (fs.existsSync(gitBinBash)) {
            return { available: true, path: gitBinBash };
        }
    }
    return { available: false };
}

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

    connect(config: { shellType: 'cmd' | 'powershell' | 'git-bash'; encoding?: string }) {
        // With node-pty, we generally use UTF-8 as it handles the translation.
        this.encoding = config.encoding || 'utf8';

        let shell: string;
        let args: string[] = [];
        if (config.shellType === 'git-bash') {
            const detection = detectGitBash();
            if (!detection.available || !detection.path) {
                logger.error('local', 'Git Bash not found', { sessionId: this.sessionId });
                this.window.webContents.send('session-error', { sessionId: this.sessionId, error: 'Git Bash is not installed.' });
                return;
            }
            shell = detection.path;
            args = ['--login', '-i'];
        } else {
            shell = config.shellType === 'powershell' ? 'powershell.exe' : 'cmd.exe';
        }
        logger.info('local', 'Connect attempt', { sessionId: this.sessionId, shell });

        const sanitizedEnv = sanitizeProcessEnv();

        // Git Bash: prefer USERPROFILE so it starts in the Windows home directory
        const cwd = config.shellType === 'git-bash'
            ? (process.env.USERPROFILE || process.env.HOME)
            : (process.env.HOME || process.env.USERPROFILE);

        try {
            this.ptyProcess = pty.spawn(shell, args, {
                name: 'xterm-256color',
                cols: 80,
                rows: 24,
                cwd,
                env: sanitizedEnv,
                encoding: 'utf8' // Internal PTY encoding
            });

            logger.info('local', 'Connected', { sessionId: this.sessionId });
            this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'connected' });

            this.ptyProcess.onData((data: string) => {
                if (!this.window.isDestroyed()) {
                    this.window.webContents.send('session-data', { sessionId: this.sessionId, data });
                }
                if (this.dataCallback) {
                    this.dataCallback(data);
                }
            });

            this.ptyProcess.onExit(({ exitCode, signal }) => {
                logger.info('local', 'Process exited', { sessionId: this.sessionId, exitCode, signal });
                if (!this.window.isDestroyed()) {
                    this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'disconnected' });
                }
            });

        } catch (err: unknown) {
            logger.error('local', 'Spawn error', { sessionId: this.sessionId, error: err instanceof Error ? err.message : String(err) });
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
