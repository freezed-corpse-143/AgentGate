import type { ChannelAdapter, MessageCallback } from './base.js';
import type { ChannelType, Envelope } from '../types.js';
export interface SSHAdapterOptions {
    port: number;
    host?: string;
    users?: Record<string, string>;
}
export declare class SSHAdapter implements ChannelAdapter {
    readonly channelType: ChannelType;
    private server;
    private callback;
    private options;
    private running;
    private sessions;
    constructor(options: SSHAdapterOptions);
    onMessage(callback: MessageCallback): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    send(envelope: Envelope): Promise<void>;
    addUser(username: string, password: string): void;
    private getOrCreateHostKey;
    private handleClient;
}
//# sourceMappingURL=ssh_adapter.d.ts.map