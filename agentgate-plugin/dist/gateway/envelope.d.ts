import type { Envelope, EnvelopeDirection, EnvelopeType, ChannelType, EnvelopePayload, AuthInfo } from '../types.js';
/** 生成全局唯一 message_id: msg_<timestamp><random> */
export declare function generateMessageId(): string;
/** 生成全局唯一 trace_id: trace_<timestamp><random> */
export declare function generateTraceId(): string;
/** 生成一致的 conversation_id: conv_<date>_<seq> */
export declare function generateConversationId(channel: ChannelType, userId: string): string;
export interface CreateEnvelopeOptions {
    channel: ChannelType;
    channel_user_id: string;
    agent_id: string;
    direction: EnvelopeDirection;
    type: EnvelopeType;
    payload: EnvelopePayload;
    conversation_id?: string;
    workspace_id?: string;
    auth?: AuthInfo;
    trace_id?: string;
    /** 跨 Agent 路由目标 */
    target_agent_id?: string;
    /** 路由历史（自动追加当前 agent_id） */
    route_history?: string[];
}
/**
 * 创建统一 Envelope。
 *
 * 每个入站消息都会经过此工厂，确保 message_id / trace_id / timestamp
 * 等元数据字段完整。这是 guide.md §2 描述的"统一消息模型"的实现。
 */
export declare function createEnvelope(options: CreateEnvelopeOptions): Envelope;
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
/**
 * 校验 Envelope 字段完整性。
 * 缺少必填字段或字段值非法时返回错误列表。
 */
export declare function validateEnvelope(env: Envelope): ValidationResult;
export declare const MAX_ROUTE_HOPS = 5;
/**
 * 检查是否超出最大路由跳数（防止 Agent 间无限循环）
 */
export declare function hasRouteLoop(env: Envelope): boolean;
/**
 * 检查指定 agent 是否已处理过此消息
 */
export declare function wasProcessedBy(env: Envelope, agentId: string): boolean;
export declare function serializeEnvelope(env: Envelope): string;
export declare function deserializeEnvelope(json: string): Envelope;
//# sourceMappingURL=envelope.d.ts.map