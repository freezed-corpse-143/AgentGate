/**
 * AgentGate — 核心类型定义
 *
 * 所有模块共享的统一类型。参考 guide.md §2 的 Envelope 消息模型。
 */
export type ChannelType = 'telegram' | 'rest' | 'websocket' | 'ssh' | 'tailscale' | 'agentgate';
export type EnvelopeDirection = 'inbound' | 'outbound';
export type EnvelopeType = 'text' | 'command' | 'event' | 'agent_request' | 'agent_response' | 'system_alert' | 'handoff_request' | 'handoff_accepted' | 'heartbeat' | 'tool_call' | 'tool_result';
export interface AuthInfo {
    principal_id: string;
    roles: string[];
}
export interface EnvelopePayload {
    text?: string;
    data?: Record<string, unknown>;
    error?: string;
}
export interface Envelope {
    message_id: string;
    trace_id: string;
    channel: ChannelType;
    channel_user_id: string;
    agent_id: string;
    workspace_id?: string;
    conversation_id: string;
    direction: EnvelopeDirection;
    type: EnvelopeType;
    payload: EnvelopePayload;
    auth?: AuthInfo;
    timestamp: string;
    /** 跨 Agent 路由：目标 Agent ID。不设置则回复原信道 */
    target_agent_id?: string;
    /** 跨 Agent 路由：已访问的 Agent 列表，用于循环检测 */
    route_history?: string[];
}
export type BindingStatus = 'pending' | 'active' | 'revoked';
export interface ChannelBinding {
    id: string;
    channel_type: ChannelType;
    channel_user_id: string;
    principal_id: string;
    agent_id: string;
    workspace_id?: string;
    permissions: string[];
    status: BindingStatus;
    created_at: string;
    last_seen_at: string;
}
export interface PendingPairing {
    code: string;
    channel_type: ChannelType;
    channel_user_id: string;
    chat_id: string;
    created_at: number;
    expires_at: number;
    replies: number;
}
export type AgentStatus = 'idle' | 'busy' | 'error' | 'offline';
export interface AgentSpec {
    agent_id: string;
    name: string;
    description?: string;
    capabilities: string[];
    status: AgentStatus;
    registered_at: string;
}
export interface SessionInfo {
    session_id: string;
    agent_id: string;
    channel: ChannelType;
    channel_user_id: string;
    conversation_id: string;
    created_at: string;
    last_active_at: string;
    message_count: number;
}
export interface RawMessage {
    channel: ChannelType;
    channel_user_id: string;
    chat_id: string;
    text: string;
    message_id: string;
    metadata?: Record<string, unknown>;
}
export type Permission = 'read' | 'write' | 'admin';
export interface BusEvent {
    topic: string;
    envelope: Envelope;
    published_at: number;
}
//# sourceMappingURL=types.d.ts.map