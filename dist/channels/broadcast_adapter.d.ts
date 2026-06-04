/**
 * AgentGate — 广播信道适配器
 *
 * 提供进程内广播能力。发送到 `_broadcast` topic 的消息被所有订阅者收到。
 *
 * 用途:
 *   - 一个 adapter 发消息，其他 adapter 都能收到（如通知所有 Telegram Bot）
 *   - 系统级通知推送到所有已连接的信道
 *   - 跨 agent 全局事件
 *
 * 防回环: 通过 seenIds Set 追踪已处理消息 ID，避免 A→B→A 死循环。
 */
import type { ChannelAdapter, MessageCallback } from './base.js';
import type { ChannelType, Envelope } from '../types.js';
import type { MessageBus } from '../bus/memory_bus.js';
export declare class BroadcastAdapter implements ChannelAdapter {
    readonly channelType: ChannelType;
    private bus;
    private callback;
    private running;
    private seenIds;
    constructor(bus: MessageBus);
    start(): Promise<void>;
    stop(): Promise<void>;
    send(envelope: Envelope): Promise<void>;
    onMessage(callback: MessageCallback): void;
}
//# sourceMappingURL=broadcast_adapter.d.ts.map