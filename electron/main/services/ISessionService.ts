/**
 * Common interface for SSH/Telnet services.
 * Exposing the same API for both protocols allows type-safe
 * session management from the main process.
 */
export interface ISessionService {
    /** Connect to remote host */
    connect(config: Record<string, unknown>): void | Promise<void>;

    /** Send data (user input) to remote host */
    write(data: string): void;

    /** Notify changes in terminal size */
    resize(cols: number, rows: number): void;

    /** Disconnect from remote host */
    disconnect(): void;

    /** Change character encoding */
    setEncoding(encoding: string): void;

    /** Register callback for data reception (used for logging) */
    onData(callback: (data: string) => void): void;
}
