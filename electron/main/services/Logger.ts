import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_PREFIX = 'hotty-debug-';
const MAX_AGE_DAYS = 7;

class Logger {
    private static instance: Logger;
    private logDir = '';
    private stream: fs.WriteStream | null = null;
    private currentDate = '';
    private initialized = false;

    private constructor() {}

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    initialize(userDataPath: string): void {
        if (this.initialized) return;
        this.logDir = path.join(userDataPath, 'logs');
        fs.mkdirSync(this.logDir, { recursive: true });
        this.cleanOldLogs();
        this.openStream();
        this.initialized = true;
    }

    getLogDir(): string {
        return this.logDir;
    }

    private todayStr(d: Date = new Date()): string {
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    }

    private openStream(): void {
        this.currentDate = this.todayStr();
        const fp = path.join(this.logDir, `${LOG_PREFIX}${this.currentDate}.log`);
        this.stream = fs.createWriteStream(fp, { flags: 'a', encoding: 'utf8' });
        this.stream.on('error', (err) => console.error('[Logger] stream error:', err));
    }

    private cleanOldLogs(): void {
        try {
            const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
            for (const f of fs.readdirSync(this.logDir)) {
                if (!f.startsWith(LOG_PREFIX) || !f.endsWith('.log')) continue;
                const fp = path.join(this.logDir, f);
                try {
                    if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
                } catch { /* ignore */ }
            }
        } catch { /* ignore */ }
    }

    private checkRollover(now: Date): void {
        const today = this.todayStr(now);
        if (today !== this.currentDate) {
            this.stream?.end();
            this.stream = null;
            this.cleanOldLogs();
            this.openStream();
        }
    }

    log(level: LogLevel, category: string, message: string, fields?: Record<string, unknown>): void {
        const now = new Date();
        const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0')}`;
        let line = `[${ts}] [${level.padEnd(5)}] [${category.padEnd(8)}] ${message}`;
        if (fields && Object.keys(fields).length > 0) {
            line += ' | ' + Object.entries(fields).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
        }

        if (level === 'ERROR') console.error(line);
        else if (level === 'WARN') console.warn(line);
        else console.log(line);

        if (!this.initialized) return;
        this.checkRollover(now);
        if (this.stream && !this.stream.destroyed) {
            this.stream.write(line + '\n');
        }
    }

    debug(category: string, message: string, fields?: Record<string, unknown>): void { this.log('DEBUG', category, message, fields); }
    info(category: string, message: string, fields?: Record<string, unknown>): void { this.log('INFO', category, message, fields); }
    warn(category: string, message: string, fields?: Record<string, unknown>): void { this.log('WARN', category, message, fields); }
    error(category: string, message: string, fields?: Record<string, unknown>): void { this.log('ERROR', category, message, fields); }

    close(): void {
        this.stream?.end();
        this.stream = null;
    }
}

export const logger = Logger.getInstance();

const SENSITIVE_ENV_KEY_PATTERN = /(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE[_-]?KEY|ACCESS[_-]?KEY)/i;

/** Returns a copy of process.env with secret-looking keys removed. */
export function sanitizeProcessEnv(): NodeJS.ProcessEnv {
    return Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !SENSITIVE_ENV_KEY_PATTERN.test(key))
    ) as NodeJS.ProcessEnv;
}
