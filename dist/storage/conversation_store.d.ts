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
    constructor(agentId?: string);
    /** 将 ~/.agentgate/conversations/ 中的旧对话迁移到 agent 子目录 */
    private migrateFromBaseDir;
    private convPath;
    private loadIndex;
    /** 原子写入：先写临时文件，再 rename，崩溃安全 */
    private saveConversation;
    private loadMessages;
    /** 追加一条消息到对话（自动去重） */
    appendMessage(msg: MessageRecord): void;
    /** 查询对话消息 (按时间正序) */
    getMessages(conversationId: string, options?: {
        limit?: number;
        offset?: number;
    }): MessageRecord[];
    /** 更新消息文本（用于编辑）返回是否成功 */
    updateMessage(convId: string, messageId: string, text: string): boolean;
    /** 给消息添加表情反应 */
    addReaction(convId: string, messageId: string, emoji: string, agentId: string): boolean;
    /** 获取会话概要 */
    getConversation(conversationId: string): ConversationSummary | undefined;
    /** 列出所有会话 (按最后活跃时间降序) */
    listConversations(agentId?: string): ConversationSummary[];
    /** 删除会话 */
    deleteConversation(conversationId: string): boolean;
}
//# sourceMappingURL=conversation_store.d.ts.map