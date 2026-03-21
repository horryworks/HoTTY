import * as fs from 'fs';
import * as path from 'path';
import { logger } from './Logger';

interface SessionLogEntry {
    stream: fs.WriteStream;
    tsStream: fs.WriteStream;
    atLineStart: boolean;
}

export class LogManager {
    private logPath: string;
    private logs: Map<string, SessionLogEntry> = new Map();

    constructor() {
        this.logPath = '';
    }

    startLogging(sessionId: string, config: { loggingEnabled: boolean; loggingPath: string; host?: string; protocol?: string }) {
        if (!config.loggingEnabled || !config.loggingPath) {
            return;
        }

        // Skip if already logging this session
        if (this.logs.has(sessionId)) {
            return;
        }

        try {
            if (!fs.existsSync(config.loggingPath)) {
                logger.warn('logmanager', `Log folder does not exist: ${config.loggingPath}`);
                return;
            }

            const protocol = config.protocol?.toUpperCase() || 'UNKNOWN';
            const host = config.host || 'UNKNOWN_HOST';
            // Sanitize host for filename
            const sanitizedHost = host.replace(/[^a-zA-Z0-9.-]/g, '_');

            const date = new Date();
            const timestamp = date.getFullYear().toString() +
                (date.getMonth() + 1).toString().padStart(2, '0') +
                date.getDate().toString().padStart(2, '0') +
                date.getHours().toString().padStart(2, '0') +
                date.getMinutes().toString().padStart(2, '0') +
                date.getSeconds().toString().padStart(2, '0');

            const baseName = `${timestamp}-${protocol}-${sanitizedHost}`;
            let fileName = `${baseName}.txt`;
            let counter = 1;

            while (fs.existsSync(path.join(config.loggingPath, fileName))) {
                fileName = `${baseName}-${counter}.txt`;
                counter++;
            }

            const fullPath = path.join(config.loggingPath, fileName);
            const tsPath = fullPath.replace(/\.txt$/, '.tslog');

            const stream = fs.createWriteStream(fullPath, { flags: 'a', encoding: 'utf8' });
            const tsStream = fs.createWriteStream(tsPath, { flags: 'a', encoding: 'utf8' });

            stream.on('error', (err) => {
                logger.error('logmanager', `Failed to write log for session ${sessionId}`, { error: String(err) });
                this.stopLogging(sessionId);
            });
            tsStream.on('error', (err) => {
                logger.error('logmanager', `Failed to write timestamp log for session ${sessionId}`, { error: String(err) });
            });

            this.logs.set(sessionId, { stream, tsStream, atLineStart: true });
            logger.info('logmanager', `Started logging for session ${sessionId} to ${fullPath}`);

        } catch (err) {
            logger.error('logmanager', 'Failed to start logging', { error: String(err) });
        }
    }

    write(sessionId: string, data: string) {
        const log = this.logs.get(sessionId);
        if (!log) return;

        // Strip ANSI escape codes and normalize newlines
        const cleanData = this.processLogData(data);
        if (!cleanData) return;

        log.stream.write(cleanData);

        // Write one timestamp per line to .tslog (line N in .txt ↔ line N in .tslog)
        const now = new Date();
        const tsStr = this.formatTimestamp(now);
        let tsOutput = '';
        let { atLineStart } = log;

        for (const char of cleanData) {
            if (atLineStart) {
                tsOutput += tsStr + '\n';
                atLineStart = false;
            }
            if (char === '\n') {
                atLineStart = true;
            }
        }

        if (tsOutput) {
            log.tsStream.write(tsOutput);
        }
        log.atLineStart = atLineStart;
    }

    private formatTimestamp(date: Date): string {
        const pad2 = (n: number) => String(n).padStart(2, '0');
        const pad3 = (n: number) => String(n).padStart(3, '0');
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
               `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}`;
    }

    private processLogData(str: string): string {
        // 1. Strip ANSI escape codes
        // eslint-disable-next-line no-control-regex
        let clean = str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

        // 2. Normalize newlines: CRLF -> LF
        clean = clean.replace(/\r\n/g, '\n');

        // 3. Remove standalone CR (often used for progress bars or overwriting lines)
        clean = clean.replace(/\r/g, '');

        return clean;
    }

    stopLogging(sessionId: string) {
        const log = this.logs.get(sessionId);
        if (log) {
            log.stream.end();
            log.tsStream.end();
            this.logs.delete(sessionId);
            logger.info('logmanager', `Stopped logging for session ${sessionId}`);
        }
    }
}
