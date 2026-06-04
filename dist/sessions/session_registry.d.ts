import type { SessionInfo, ChannelType } from '../types.js';
export declare class SessionRegistry {
    private cache;
    private load;
    private save;
    /** 查找或创建会话 */
    getOrCreate(agentId: string, channel: ChannelType, channelUserId: string): SessionInfo;
    /** 按 ID 获取会话 */
    getById(sessionId: string): SessionInfo | undefined;
    /** 关闭会话 */
    closeSession(sessionId: string): void;
    /** 列出某 agent 的活跃会话 */
    listByAgent(agentId: string): SessionInfo[];
    /** 列出所有活跃会话 */
    listAll(): SessionInfo[];
}
//# sourceMappingURL=session_registry.d.ts.map