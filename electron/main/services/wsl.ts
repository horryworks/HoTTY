import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { BrowserWindow } from 'electron';
import * as iconv from 'iconv-lite';
import { ISessionService } from './ISessionService';

export class WslService implements ISessionService {
    private process: ChildProcessWithoutNullStreams | null = null;
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

    connect(config: { distro?: string; encoding?: string }) {
        this.encoding = config.encoding || 'utf8';
        const distro = config.distro || '';

        const args: string[] = [];
        if (distro) {
            args.push('-d', distro);
        }

        // Use 'script' to trick the shell into thinking it has a TTY
        // This is a common workaround when node-pty is not available.
        args.push('script', '-q', '-c', '/bin/bash', '/dev/null');

        try {
            console.log(`Spawning WSL with args:`, args);
            this.process = spawn('wsl.exe', args, {
                env: { ...process.env, TERM: 'xterm-256color' },
                shell: false,
                windowsHide: true
            });
            console.log(`WSL process spawned successfully for session ${this.sessionId}.`);

            this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'connected' });

            this.process.stdout.on('data', (data: Buffer) => {
                const text = iconv.decode(data, this.encoding);
                this.window.webContents.send('session-data', { sessionId: this.sessionId, data: text });
                if (this.dataCallback) {
                    this.dataCallback(text);
                }
            });

            this.process.stderr.on('data', (data: Buffer) => {
                const text = iconv.decode(data, this.encoding);
                this.window.webContents.send('session-data', { sessionId: this.sessionId, data: text });
                if (this.dataCallback) {
                    this.dataCallback(text);
                }
            });

            this.process.on('error', (err) => {
                console.error(`WSL Process Error (Session ${this.sessionId}):`, err);
                this.window.webContents.send('session-error', { sessionId: this.sessionId, error: `WSL Start Error: ${err.message}` });
            });

            this.process.on('close', (code) => {
                console.log(`WSL Process Closed (Session ${this.sessionId}) with code:`, code);
                this.window.webContents.send('session-status', { sessionId: this.sessionId, status: 'disconnected' });
            });

        } catch (err: any) {
            this.window.webContents.send('session-error', { sessionId: this.sessionId, error: err.message });
        }
    }

    write(data: string) {
        if (this.process && this.process.stdin) {
            console.log(`WSL write (Session ${this.sessionId}):`, { data, length: data.length });
            const buffer = iconv.encode(data, this.encoding);
            this.process.stdin.write(buffer);
        }
    }

    resize(cols: number, rows: number) {
        // wsl.exe directly doesn't support easy resizing without a pseudo-terminal (node-pty).
        // For a basic implementation, we might skip this or use a workaround if needed.
        // In a real terminal, node-pty is preferred for this.
    }

    disconnect() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
}
