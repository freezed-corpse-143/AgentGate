import type { ChannelType } from '../types.js';
export type MessageRole = 'user' | 'agent' | 'system';
export interface MessageRecord {
    message_id: string;
    conversation_id: string;
    agent_id: string;
    role: MessageRole;
    text: string;
    channel: ChannelType;
    channel_user_id: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
}
export interface ConversationSummary {
    conversation_id: string;
    agent_id: string;
    channel: ChannelType;
    channel_user_id: string;
    message_count: number;
    created_at: string;
    last_active_at: string;
    summary?: string;
}
export type AppendCallback = (record: MessageRecord) => void;
export declare class ConversationStore {
    private convDir;
    /** 会话概要索引 (conversation_id → summary) */
    private index;
    private indexLoaded;
    /** 追加消息时的回调（用于跨进程同步） */
    onAppend: AppendCallback | null;
    constructor();
    private convPath;
    private loadIndex;
    private saveConversation;
    private loadMessages;
    /** 追加一条消息到对话 */
    appendMessage(msg: MessageRecord): void;
    /** 查询对话消息 (按时间正序) */
    getMessages(conversationId: string, options?: {
        limit?: number;
        offset?: number;
    }): MessageRecord[];
    /** 获取会话概要 */
    getConversation(conversationId: string): ConversationSummary | undefined;
    /** 列出所有会话 (按最后活跃时间降序) */
    listConversations(agentId?: string): ConversationSummary[];
    /** 删除会话 */
    deleteConversation(conversationId: string): boolean;
}
//# sourceMappingURL=conversation_store.d.ts.map