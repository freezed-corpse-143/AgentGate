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
import type { MessageBus } from '../bus/memory_bus.js'
import type { Envelope } from '../types.js'
import type { AgentRegistry } from './registry.js'
import type { SessionRouter } from '../sessions/router.js'
import type { ConversationStore, MessageRecord } from '../storage/conversation_store.js'
import { createEnvelope, hasRouteLoop, wasProcessedBy } from '../gateway/envelope.js'

/**
 * Agent 业务逻辑处理器的返回类型。
 * - 返回字符串: 普通回复 (发送回原信道)
 * - 返回 { text, target_agent_id }: 跨 Agent 路由
 * - 返回 null: 不回复
 */
export type HandlerResult = string | { text: string; target_agent_id: string } | null

export type AgentHandler = (envelope: Envelope) => Promise<HandlerResult>

export class AgentRuntime {
  private bus: MessageBus
  private agentRegistry: AgentRegistry
  private sessionRouter: SessionRouter
  private handlers: Map<string, AgentHandler> = new Map()
  private conversationStore?: ConversationStore

  constructor(
    bus: MessageBus,
    agentRegistry: AgentRegistry,
    sessionRouter: SessionRouter,
    conversationStore?: ConversationStore,
  ) {
    this.bus = bus
    this.agentRegistry = agentRegistry
    this.sessionRouter = sessionRouter
    this.conversationStore = conversationStore
  }

  /** 注册某 Agent 的消息处理器 */
  setHandler(agentId: string, handler: AgentHandler): void {
    this.handlers.set(agentId, handler)
  }

  /** 启动监听 */
  start(): void {
    this.bus.subscribeWildcard('agent.*.inbound', async (envelope) => {
      // agent_id 过滤: 只处理已注册 handler 的 Agent 的消息
      // 当没有任何 handler 注册时（兼容旧行为），处理全部
      if (this.handlers.size > 0 && !this.handlers.has(envelope.agent_id)) {
        return
      }
      await this.handle(envelope)
    })
    const agents = this.handlers.size > 0
      ? `agents: [${[...this.handlers.keys()].join(', ')}]`
      : 'all agents (no handlers registered)'
    console.log(`[AgentRuntime] Started — listening on agent.*.inbound (${agents})`)
  }

  /** 记录消息到 ConversationStore */
  private recordMessage(
    envelope: Envelope,
    role: MessageRecord['role'],
    text?: string,
  ): void {
    if (!this.conversationStore) return
    const msgText = text ?? envelope.payload.text ?? ''
    const record: MessageRecord = {
      message_id: envelope.message_id,
      conversation_id: envelope.conversation_id,
      agent_id: envelope.agent_id,
      role,
      text: msgText,
      channel: envelope.channel,
      channel_user_id: envelope.channel_user_id,
      timestamp: envelope.timestamp,
      metadata: { trace_id: envelope.trace_id },
    }
    try {
      this.conversationStore.appendMessage(record)
    } catch (err) {
      console.error(`[AgentRuntime] Failed to record message: ${err}`)
    }
  }

  /** 处理单条入站 Envelope */
  private async handle(envelope: Envelope): Promise<void> {
    // ── 循环检测 ──────────────────────────────────────────────
    if (hasRouteLoop(envelope)) {
      console.warn(`[AgentRuntime] Route loop detected for ${envelope.message_id}, dropping`)
      return
    }
    if (wasProcessedBy(envelope, envelope.agent_id)) {
      console.warn(`[AgentRuntime] ${envelope.agent_id} already processed ${envelope.message_id}, dropping`)
      return
    }

    // ── 刷新绑定会话 ─────────────────────────────────────────
    const route = this.sessionRouter.route(envelope)
    if (!route) {
      console.warn(`[AgentRuntime] No route for: ${envelope.message_id}`)
      return
    }
    if (!route.agentExists) {
      console.warn(`[AgentRuntime] Agent not found: ${envelope.agent_id}`)
      return
    }

    // ── 追加当前 Agent 到路由历史 ───────────────────────────
    if (!envelope.route_history) {
      (envelope as any).route_history = []
    }
    if (!envelope.route_history!.includes(envelope.agent_id)) {
      envelope.route_history!.push(envelope.agent_id)
    }

    // ── 记录入站消息 ─────────────────────────────────────────
    this.recordMessage(envelope, 'user')

    this.agentRegistry.updateStatus(envelope.agent_id, 'busy')

    try {
      const handler = this.handlers.get(envelope.agent_id)
      let result: HandlerResult = null

      if (handler) {
        result = await handler(envelope)
      } else {
        result = `[${envelope.agent_id}] Received: ${envelope.payload.text ?? '(empty)'}`
      }

      if (!result) return

      // ── 解析结果 ────────────────────────────────────────────
      let replyText: string
      let targetAgent: string | undefined

      if (typeof result === 'string') {
        replyText = result
        targetAgent = undefined
      } else {
        replyText = result.text
        targetAgent = result.target_agent_id
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
      })

      // ── 记录回复消息 ────────────────────────────────────
      const responseAgent = targetAgent ?? envelope.agent_id
      this.recordMessage({ ...response, agent_id: responseAgent }, 'agent', replyText)

      // ── 路由决策 ──────────────────────────────────────────
      if (targetAgent && targetAgent !== envelope.agent_id) {
        // 跨 Agent 路由: 更新 agent_id 为目标 Agent，然后发布到目标 inbound
        response.agent_id = targetAgent
        console.log(
          `[AgentRuntime] Routing ${envelope.message_id} → ${targetAgent} ` +
          `(hop ${(response.route_history ?? []).length})`,
        )
        this.bus.publish(`agent.${targetAgent}.inbound`, response)
      } else {
        // 普通回复: 原信道
        this.bus.publish(`agent.${envelope.agent_id}.outbound`, response)
      }
    } catch (err) {
      console.error(`[AgentRuntime] Handler error for ${envelope.message_id}: ${err}`)
    } finally {
      this.agentRegistry.updateStatus(envelope.agent_id, 'idle')
    }
  }
}
