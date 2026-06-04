import { createEnvelope, hasRouteLoop, wasProcessedBy } from '../gateway/envelope.js';
export class AgentRuntime {
    bus;
    agentRegistry;
    sessionRouter;
    handlers = new Map();
    conversationStore;
    constructor(bus, agentRegistry, sessionRouter, conversationStore) {
        this.bus = bus;
        this.agentRegistry = agentRegistry;
        this.sessionRouter = sessionRouter;
        this.conversationStore = conversationStore;
    }
    /** 注册某 Agent 的消息处理器 */
    setHandler(agentId, handler) {
        this.handlers.set(agentId, handler);
    }
    /** 启动监听 */
    start() {
        this.bus.subscribeWildcard('agent.*.inbound', async (envelope) => {
            // agent_id 过滤: 只处理已注册 handler 的 Agent 的消息
            // 当没有任何 handler 注册时（兼容旧行为），处理全部
            if (this.handlers.size > 0 && !this.handlers.has(envelope.agent_id)) {
                return;
            }
            await this.handle(envelope);
        });
        const agents = this.handlers.size > 0
            ? `agents: [${[...this.handlers.keys()].join(', ')}]`
            : 'all agents (no handlers registered)';
        console.error(`[AgentRuntime] Started — listening on agent.*.inbound (${agents})`);
    }
    /** 记录消息到 ConversationStore */
    recordMessage(envelope, role, text) {
        if (!this.conversationStore)
            return;
        const msgText = text ?? envelope.payload.text ?? '';
        const record = {
            message_id: envelope.message_id,
            conversation_id: envelope.conversation_id,
            agent_id: envelope.agent_id,
            role,
            text: msgText,
            channel: envelope.channel,
            channel_user_id: envelope.channel_user_id,
            timestamp: envelope.timestamp,
            metadata: { trace_id: envelope.trace_id },
        };
        try {
            this.conversationStore.appendMessage(record);
        }
        catch (err) {
            console.error(`[AgentRuntime] Failed to record message: ${err}`);
        }
    }
    /** 处理单条入站 Envelope */
    async handle(envelope) {
        // ── 循环检测 ──────────────────────────────────────────────
        if (hasRouteLoop(envelope)) {
            console.warn(`[AgentRuntime] Route loop detected for ${envelope.message_id}, dropping`);
            return;
        }
        if (wasProcessedBy(envelope, envelope.agent_id)) {
            console.warn(`[AgentRuntime] ${envelope.agent_id} already processed ${envelope.message_id}, dropping`);
            return;
        }
        // ── 刷新绑定会话 ─────────────────────────────────────────
        const route = this.sessionRouter.route(envelope);
        if (!route) {
            console.warn(`[AgentRuntime] No route for: ${envelope.message_id}`);
            return;
        }
        if (!route.agentExists) {
            console.warn(`[AgentRuntime] Agent not found: ${envelope.agent_id}`);
            return;
        }
        // ── 追加当前 Agent 到路由历史 ───────────────────────────
        if (!envelope.route_history) {
            envelope.route_history = [];
        }
        if (!envelope.route_history.includes(envelope.agent_id)) {
            envelope.route_history.push(envelope.agent_id);
        }
        // ── 记录入站消息 ─────────────────────────────────────────
        this.recordMessage(envelope, 'user');
        this.agentRegistry.updateStatus(envelope.agent_id, 'busy');
        try {
            const handler = this.handlers.get(envelope.agent_id);
            let result = null;
            if (handler) {
                result = await handler(envelope);
            }
            else {
                result = `[${envelope.agent_id}] Received: ${envelope.payload.text ?? '(empty)'}`;
            }
            if (!result)
                return;
            // ── 解析结果 ────────────────────────────────────────────
            let replyText;
            let targetAgent;
            if (typeof result === 'string') {
                replyText = result;
                targetAgent = undefined;
            }
            else {
                replyText = result.text;
                targetAgent = result.target_agent_id;
            }
            const response = createEnvelope({
                channel: envelope.channel,
                channel_user_id: envelope.channel_user_id,
                agent_id: envelope.agent_id,
                direction: 'outbound',
                type: 'agent_response',
                payload: { text: replyText },
                conversation_id: envelope.conversation_id, // 使用与入站相同的 conversation_id
                workspace_id: envelope.workspace_id,
                auth: envelope.auth,
                trace_id: envelope.trace_id,
                target_agent_id: targetAgent,
                route_history: envelope.route_history,
            });
            // ── 记录回复消息 ────────────────────────────────────
            const responseAgent = targetAgent ?? envelope.agent_id;
            this.recordMessage({ ...response, agent_id: responseAgent }, 'agent', replyText);
            // ── 路由决策 ──────────────────────────────────────────
            if (targetAgent && targetAgent !== envelope.agent_id) {
                // 跨 Agent 路由: 更新 agent_id 为目标 Agent，然后发布到目标 inbound
                response.agent_id = targetAgent;
                console.error(`[AgentRuntime] Routing ${envelope.message_id} → ${targetAgent} ` +
                    `(hop ${(response.route_history ?? []).length})`);
                this.bus.publish(`agent.${targetAgent}.inbound`, response);
            }
            else {
                // 普通回复: 原信道
                this.bus.publish(`agent.${envelope.agent_id}.outbound`, response);
            }
        }
        catch (err) {
            console.error(`[AgentRuntime] Handler error for ${envelope.message_id}: ${err}`);
        }
        finally {
            this.agentRegistry.updateStatus(envelope.agent_id, 'idle');
        }
    }
}
//# sourceMappingURL=runtime.js.map