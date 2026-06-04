/**
 * AgentGate — Envelope 工厂与工具函数
 *
 * 负责创建、校验、序列化统一消息 Envelope。
 * 参考 Telegram 插件中消息注入会话的机制，Envelope 是整个系统的
 * "统一消息格式"——所有信道适配器的消息都转成此格式再投递。
 */
import { randomBytes, createHash } from 'crypto';
// ─── ID 生成 ───────────────────────────────────────────────────
/** 生成全局唯一 message_id: msg_<timestamp><random> */
export function generateMessageId() {
    const ts = Date.now().toString(36);
    const rand = randomBytes(6).toString('hex');
    return `msg_${ts}${rand}`;
}
/** 生成全局唯一 trace_id: trace_<timestamp><random> */
export function generateTraceId() {
    const ts = Date.now().toString(36);
    const rand = randomBytes(4).toString('hex');
    return `trace_${ts}${rand}`;
}
/** 生成一致的 conversation_id: conv_<date>_<seq> */
export function generateConversationId(channel, userId) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const hash = createHash('md5').update(`${channel}:${userId}`).digest('hex').slice(0, 8);
    return `conv_${today}_${hash}`;
}
/**
 * 创建统一 Envelope。
 *
 * 每个入站消息都会经过此工厂，确保 message_id / trace_id / timestamp
 * 等元数据字段完整。这是 guide.md §2 描述的"统一消息模型"的实现。
 */
export function createEnvelope(options) {
    const now = new Date().toISOString();
    const history = options.route_history ?? [];
    // 入站消息不自动追加 agent_id（由 Runtime 在处理时追加）
    return {
        message_id: generateMessageId(),
        trace_id: options.trace_id ?? generateTraceId(),
        channel: options.channel,
        channel_user_id: options.channel_user_id,
        agent_id: options.agent_id,
        workspace_id: options.workspace_id,
        conversation_id: options.conversation_id ??
            generateConversationId(options.channel, options.channel_user_id),
        direction: options.direction,
        type: options.type,
        payload: options.payload,
        auth: options.auth,
        timestamp: now,
        target_agent_id: options.target_agent_id,
        route_history: history,
    };
}
const REQUIRED_FIELDS = [
    'message_id',
    'trace_id',
    'channel',
    'channel_user_id',
    'agent_id',
    'conversation_id',
    'direction',
    'type',
    'payload',
    'timestamp',
];
const VALID_CHANNELS = ['telegram', 'rest', 'websocket', 'ssh', 'tailscale', 'agentgate'];
const VALID_DIRECTIONS = ['inbound', 'outbound'];
const VALID_TYPES = [
    'text', 'command', 'event', 'agent_request', 'agent_response',
    'system_alert', 'handoff_request', 'handoff_accepted', 'heartbeat',
    'tool_call', 'tool_result',
];
/**
 * 校验 Envelope 字段完整性。
 * 缺少必填字段或字段值非法时返回错误列表。
 */
export function validateEnvelope(env) {
    const errors = [];
    for (const field of REQUIRED_FIELDS) {
        if (env[field] === undefined || env[field] === null || env[field] === '') {
            errors.push(`Missing required field: ${field}`);
        }
    }
    if (env.channel && !VALID_CHANNELS.includes(env.channel)) {
        errors.push(`Invalid channel: ${env.channel}`);
    }
    if (env.direction && !VALID_DIRECTIONS.includes(env.direction)) {
        errors.push(`Invalid direction: ${env.direction}`);
    }
    if (env.type && !VALID_TYPES.includes(env.type)) {
        errors.push(`Invalid type: ${env.type}`);
    }
    return { valid: errors.length === 0, errors };
}
// ─── 路由循环检测 ──────────────────────────────────────────────
export const MAX_ROUTE_HOPS = 5;
/**
 * 检查是否超出最大路由跳数（防止 Agent 间无限循环）
 */
export function hasRouteLoop(env) {
    const history = env.route_history ?? [];
    return history.length > MAX_ROUTE_HOPS;
}
/**
 * 检查指定 agent 是否已处理过此消息
 */
export function wasProcessedBy(env, agentId) {
    return (env.route_history ?? []).includes(agentId);
}
// ─── 序列化 ────────────────────────────────────────────────────
export function serializeEnvelope(env) {
    return JSON.stringify(env);
}
export function deserializeEnvelope(json) {
    return JSON.parse(json);
}
//# sourceMappingURL=envelope.js.map