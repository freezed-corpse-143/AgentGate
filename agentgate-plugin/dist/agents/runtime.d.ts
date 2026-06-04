/**
 * AgentGate — Agent Runtime
 *
 * Agent 执行环境：订阅 Message Bus，接收入站 Envelope，执行业务逻辑，
 * 产生响应 Envelope 投递回 Bus 或转发给其他 Agent。
 *
 * 工作流程:
 *   用户消息 → Channel → Gateway → Bus → runtime.handle(envelope)
 *     → 记录会话
 *     → 执行业务逻辑 (handler)
 *     → 构造响应 Envelope
 *     ├── target_agent_id 不同 → 跨 Agent 路由 (发布到目标 inbound)
 *     └── 无 target_agent_id → 回复原信道 (outbound dispatcher)
 */
import type { MessageBus } from '../bus/memory_bus.js';
import type { Envelope } from '../types.js';
import type { AgentRegistry } from './registry.js';
import type { SessionRouter } from '../sessions/router.js';
import type { ConversationStore } from '../storage/conversation_store.js';
/**
 * Agent 业务逻辑处理器的返回类型。
 * - 返回字符串: 普通回复 (发送回原信道)
 * - 返回 { text, target_agent_id }: 跨 Agent 路由
 * - 返回 null: 不回复
 */
export type HandlerResult = string | {
    text: string;
    target_agent_id: string;
} | null;
export type AgentHandler = (envelope: Envelope) => Promise<HandlerResult>;
export declare class AgentRuntime {
    private bus;
    private agentRegistry;
    private sessionRouter;
    private handlers;
    private conversationStore?;
    constructor(bus: MessageBus, agentRegistry: AgentRegistry, sessionRouter: SessionRouter, conversationStore?: ConversationStore);
    /** 注册某 Agent 的消息处理器 */
    setHandler(agentId: string, handler: AgentHandler): void;
    /** 启动监听 */
    start(): void;
    /** 记录消息到 ConversationStore */
    private recordMessage;
    /** 处理单条入站 Envelope */
    private handle;
}
//# sourceMappingURL=runtime.d.ts.map