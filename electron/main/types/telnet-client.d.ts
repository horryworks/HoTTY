declare module 'telnet-client' {
    import { EventEmitter } from 'events';
    import { Socket } from 'net';

    export interface ConnectOptions {
        host: string;
        port?: number;
        timeout?: number;
        negotiationMandatory?: boolean;
        sendTimeout?: number;
        disableLogon?: boolean;
        stripShellPrompt?: boolean;
        terminalWidth?: number;
        terminalHeight?: number;
        irs?: string;
        ors?: string;
        echoLines?: number;
        [key: string]: unknown;
    }

    export interface SendOptions {
        waitfor?: boolean | RegExp | string;
        [key: string]: unknown;
    }

    export class Telnet extends EventEmitter {
        constructor();
        connect(options: ConnectOptions): Promise<void>;
        send(data: string, options?: SendOptions): Promise<string>;
        end(): Promise<void>;
        destroy(): Promise<void>;
        socket: Socket | null; // Expose socket for direct writes
    }
}
