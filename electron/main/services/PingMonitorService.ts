import { BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './Logger';

export interface PingResult {
    target: string;
    status: 'ok' | 'fail' | 'dns' | 'pending';
    rtt: number | null;
    ttl: number | null;
    timestamp: string;
}

// Validate that a target is a reasonable hostname/IP (no shell metacharacters)
const TARGET_PATTERN = /^[a-zA-Z0-9:][a-zA-Z0-9.:-]{0,251}[a-zA-Z0-9.:]?$/;

export function isValidPingTarget(target: string): boolean {
    if (!target || target.length > 253) return false;
    return TARGET_PATTERN.test(target);
}

export class PingMonitorService {
    private win: BrowserWindow;
    private sessionId: string;
    private targets: string[] = [];
    private intervalMs: number = 5000;
    private timer: ReturnType<typeof setInterval> | null = null;
    private running: boolean = false;
    private logStream: fs.WriteStream | null = null;
    private logFileName: string = '';
    private cycleInProgress: boolean = false;

    constructor(win: BrowserWindow, sessionId: string) {
        this.win = win;
        this.sessionId = sessionId;
    }

    start(targets: string[], intervalMs: number, loggingEnabled: boolean, loggingPath: string) {
        this.targets = targets.filter(t => isValidPingTarget(t));
        this.intervalMs = Math.max(1000, intervalMs);
        this.running = true;

        if (loggingEnabled && loggingPath) {
            this.startLogging(loggingPath);
        }

        logger.info('ping-monitor', 'Started', {
            sessionId: this.sessionId,
            targetCount: this.targets.length,
            intervalMs: this.intervalMs,
        });

        this.runPingCycle();
        this.timer = setInterval(() => this.runPingCycle(), this.intervalMs);
    }

    stop() {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.logStream) {
            this.logStream.end();
            this.logStream = null;
        }
        logger.info('ping-monitor', 'Stopped', { sessionId: this.sessionId });
    }

    updateTargets(targets: string[]) {
        this.targets = targets.filter(t => isValidPingTarget(t));
    }

    updateInterval(intervalMs: number) {
        this.intervalMs = Math.max(1000, intervalMs);
        if (this.running && this.timer) {
            clearInterval(this.timer);
            this.timer = setInterval(() => this.runPingCycle(), this.intervalMs);
        }
    }

    isRunning(): boolean {
        return this.running;
    }

    private startLogging(loggingPath: string) {
        try {
            const resolvedPath = path.resolve(loggingPath);
            if (!fs.existsSync(resolvedPath)) return;

            const date = new Date();
            const timestamp = date.getFullYear().toString() +
                (date.getMonth() + 1).toString().padStart(2, '0') +
                date.getDate().toString().padStart(2, '0') +
                date.getHours().toString().padStart(2, '0') +
                date.getMinutes().toString().padStart(2, '0') +
                date.getSeconds().toString().padStart(2, '0');

            let fileName = `${timestamp}-PING-MONITOR.csv`;
            let counter = 1;
            while (fs.existsSync(path.join(resolvedPath, fileName))) {
                fileName = `${timestamp}-PING-MONITOR-${counter}.csv`;
                counter++;
            }

            this.logFileName = fileName;
            const fullPath = path.join(resolvedPath, fileName);
            this.logStream = fs.createWriteStream(fullPath, { flags: 'a', encoding: 'utf8' });
            this.logStream.on('error', (err) => {
                logger.error('ping-monitor', 'Log write error', { error: String(err) });
                this.logStream = null;
            });
            this.logStream.write('timestamp,target,status,rtt_ms,ttl\n');

            if (!this.win.isDestroyed()) {
                this.win.webContents.send('ping-monitor-log-file', {
                    sessionId: this.sessionId,
                    fileName,
                });
            }
        } catch (err) {
            logger.error('ping-monitor', 'Failed to start logging', { error: String(err) });
        }
    }

    private async runPingCycle() {
        if (!this.running || this.targets.length === 0 || this.cycleInProgress) return;
        this.cycleInProgress = true;

        try {
            const promises = this.targets.map(target => this.pingTarget(target));
            const settled = await Promise.allSettled(promises);
            const results: PingResult[] = [];

            for (const result of settled) {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                    if (this.logStream) {
                        const r = result.value;
                        const escapedTarget = r.target.replace(/,/g, '');
                        this.logStream.write(
                            `${r.timestamp},${escapedTarget},${r.status},${r.rtt ?? ''},${r.ttl ?? ''}\n`
                        );
                    }
                }
            }

            if (this.running && !this.win.isDestroyed()) {
                this.win.webContents.send('ping-monitor-data', {
                    sessionId: this.sessionId,
                    results,
                });
            }
        } finally {
            this.cycleInProgress = false;
        }
    }

    private pingTarget(target: string): Promise<PingResult> {
        return new Promise((resolve) => {
            const now = new Date();
            const timestamp = this.formatTimestamp(now);

            const proc = spawn('ping', ['-n', '1', '-w', '3000', target], {
                windowsHide: true,
            });

            let stdout = '';
            proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
            proc.stderr.on('data', (data: Buffer) => { stdout += data.toString(); });

            const killTimeout = setTimeout(() => {
                proc.kill();
                resolve({ target, status: 'fail', rtt: null, ttl: null, timestamp });
            }, 5000);

            proc.on('close', (code) => {
                clearTimeout(killTimeout);
                if (code === 0) {
                    const rttMatch = stdout.match(/time[=<](\d+)ms/i);
                    const ttlMatch = stdout.match(/TTL=(\d+)/i);
                    resolve({
                        target,
                        status: 'ok',
                        rtt: rttMatch ? parseInt(rttMatch[1], 10) : null,
                        ttl: ttlMatch ? parseInt(ttlMatch[1], 10) : null,
                        timestamp,
                    });
                } else {
                    // Detect DNS resolution failure
                    const isDnsFailure = /could not find host|getaddrinfo failed/i.test(stdout);
                    resolve({ target, status: isDnsFailure ? 'dns' : 'fail', rtt: null, ttl: null, timestamp });
                }
            });

            proc.on('error', () => {
                clearTimeout(killTimeout);
                resolve({ target, status: 'fail', rtt: null, ttl: null, timestamp });
            });
        });
    }

    private formatTimestamp(date: Date): string {
        const pad2 = (n: number) => String(n).padStart(2, '0');
        const pad3 = (n: number) => String(n).padStart(3, '0');
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
               `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}`;
    }

    getLogFileName(): string {
        return this.logFileName;
    }
}
