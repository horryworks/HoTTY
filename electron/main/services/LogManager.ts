import * as fs from 'fs';
import * as path from 'path';

export class LogManager {
    private logPath: string;
    private streams: Map<string, fs.WriteStream> = new Map();

    constructor() {
        this.logPath = '';
    }

    startLogging(sessionId: string, config: { loggingEnabled: boolean; loggingPath: string; host?: string; protocol?: string }) {
        if (!config.loggingEnabled || !config.loggingPath) {
            return;
        }

        // Skip if already logging this session
        if (this.streams.has(sessionId)) {
            return;
        }

        try {
            if (!fs.existsSync(config.loggingPath)) {
                // If path doesn't exist, we probably shouldn't try to create it blindly, 
                // but let's assume valid folder selection.
                // Or maybe we treat it as error? 
                // Let's try to mkdir it recursively just in case?
                // Usually loggingPath is a folder selected by user.
                console.warn(`Log folder does not exist: ${config.loggingPath}`);
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
            const stream = fs.createWriteStream(fullPath, { flags: 'a', encoding: 'utf8' });

            stream.on('error', (err) => {
                console.error(`Failed to write log for session ${sessionId}:`, err);
                this.stopLogging(sessionId);
            });

            this.streams.set(sessionId, stream);
            console.log(`Started logging for session ${sessionId} to ${fullPath}`);

        } catch (err) {
            console.error('Failed to start logging:', err);
        }
    }

    write(sessionId: string, data: string) {
        const stream = this.streams.get(sessionId);
        if (stream) {
            // Strip ANSI escape codes and normalize newlines
            const cleanData = this.processLogData(data);
            if (cleanData) {
                stream.write(cleanData);
            }
        }
    }

    private processLogData(str: string): string {
        // 1. Strip ANSI escape codes
        // eslint-disable-next-line no-control-regex
        let clean = str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

        // 2. Normalize newlines: CRLF -> LF
        clean = clean.replace(/\r\n/g, '\n');

        // 3. Remove standalone CR (often used for progress bars or overwriting lines)
        // In a text log, we usually just want the final content, but 'appending' is safer than weird chars.
        // We'll just remove them to avoid "double line" visual artifacts if viewer interprets them.
        clean = clean.replace(/\r/g, '');

        return clean;
    }

    stopLogging(sessionId: string) {
        const stream = this.streams.get(sessionId);
        if (stream) {
            stream.end();
            this.streams.delete(sessionId);
            console.log(`Stopped logging for session ${sessionId}`);
        }
    }
}
