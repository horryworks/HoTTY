declare module 'telnet-client' {
    import { EventEmitter } from 'events';
    import { Socket } from 'net';

    export interface ConnectOptions {
        host: string;
        port?: number;
        timeout?: number;
        negotiationMandatory?: boolean;
        sendTimeout?: number;
        [key: string]: any;
    }

    export interface SendOptions {
        waitfor?: boolean | RegExp | string;
        [key: string]: any;
    }

    export class Telnet extends EventEmitter {
        constructor();
        connect(options: ConnectOptions): Promise<void>;
        send(data: string, options?: SendOptions): Promise<string>;
        end(): Promise<void>;
        destroy(): Promise<void>;
        socket: any; // Expose socket for direct writes
    }
}
