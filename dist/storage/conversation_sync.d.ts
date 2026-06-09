/**
 * AgentGate — Conversation Sync
 *
 * 跨进程对话记录同步。通过 MessageBus 的 _system.conversation.sync topic
 * 将本地追加的消息广播到其他进程的 ConversationStore。
 *
 * 架构:
 *   Local append → onAppend callback → publish to _system.conversation.sync
 *     → BridgeClient → BridgeServer → 其他 BridgeClient
 *       → 其他进程的 bus → _system.conversation.sync handler
 *         → append to remote ConversationStore
 *
 * 环路避免: 追踪已同步的 message_id，不重复广播。
 */
import type { MessageBus } from '../bus/memory_bus.js';
import type { ConversationStore } from './conversation_store.js';
export interface ConversationSyncOptions {
    /** 是否启用同步（默认 true） */
    enabled?: boolean;
}
/**
 * 跨进程对话同步器。挂接到 ConversationStore.onAppend，
 * 将新消息通过 MessageBus 广播到其他进程。
 */
export declare class ConversationSync {
    private bus;
    private store;
    private enabled;
    /** 追踪已从远端同步的 message_id，防止回路。值: 加入时间戳 */
    private syncedIds;
    private lastCleanup;
    constructor(bus: MessageBus, store: ConversationStore, opts?: ConversationSyncOptions);
    /** 本地追加消息 → 广播到远端 */
    private handleLocalAppend;
    /** 收到远端同步消息 → 追加/编辑/反应到本地 */
    private handleRemoteSync;
    /** 停止同步 */
    stop(): void;
    /** LRU 淘汰：超过上限时淘汰最旧的一半条目，保留最近的 */
    private cleanup;
}
//# sourceMappingURL=conversation_sync.d.ts.map