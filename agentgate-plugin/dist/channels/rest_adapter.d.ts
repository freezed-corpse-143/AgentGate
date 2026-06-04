import type { ChannelAdapter, MessageCallback } from './base.js';
import type { ChannelType, Envelope } from '../types.js';
import type { HandshakeManager } from '../auth/handshake.js';
import type { ConversationStore } from '../storage/conversation_store.js';
import type { MessageBus } from '../bus/memory_bus.js';
export interface RESTAdapterOptions {
    port: number;
    host?: string;
    handshake?: HandshakeManager;
    conversationStore?: ConversationStore;
    bus?: MessageBus;
}
export declare class RESTAdapter implements ChannelAdapter {
    readonly channelType: ChannelType;
    private httpServer;
    private wss;
    private callback;
    private wsClients;
    private options;
    private convStore?;
    private bus?;
    /** SSE 客户端 */
    private sseClients;
    /** 启动时间 */
    private startedAt;
    constructor(options: RESTAdapterOptions);
    /** 监听 Bus 事件并广播给 SSE/WS 客户端 */
    private setupBusListener;
    onMessage(callback: MessageCallback): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    send(envelope: Envelope): Promise<void>;
    private handleInboundMessage;
    private handlePair;
    private handleVerify;
    private handleHealth;
    private handleWSMessage;
    private handleSSE;
    private handleDashboard;
    private handleListConversations;
    private handleGetMessages;
    private handleDeleteConversation;
    private readBody;
}
//# sourceMappingURL=rest_adapter.d.ts.map