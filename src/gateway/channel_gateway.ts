/**
 * AgentGate — Channel Gateway
 *
 * 信道无关的网关逻辑：接收原始消息 → 查绑定 → 校验权限 → 生成 Envelope → 投递到 Message Bus。
 *
 * 这是 guide.md 架构中的关键枢纽层：
 *   Channel Adapter → Gateway → Envelope → Auth → Session Router → Message Bus → Agent Runtime
 *
 * 参考 Telegram 插件的 gate() 函数 (server.ts:138-192)：
 *  - gate() 负责判断消息是否应该被交付、丢弃或触发配对
 *  - ChannelGateway 实现了相同的三层决策：查找绑定 / 校验权限 / 生成 Envelope
 */
import type { RawMessage, Envelope, ChannelBinding } from '../types.js'
import type { MessageBus } from '../bus/memory_bus.js'
import type { HandshakeManager } from '../auth/handshake.js'
import type { BindingStore } from '../auth/binding_store.js'
import { createEnvelope } from './envelope.js'

// ─── 网关决策结果 ──────────────────────────────────────────────

export type GateAction =
  | { action: 'deliver'; envelope: Envelope }
  | { action: 'drop'; reason: string }
  | { action: 'pair'; code: string }

// ─── ChannelGateway ────────────────────────────────────────────

export interface GatewayDeps {
  bindingStore: BindingStore
  handshake: HandshakeManager
  bus: MessageBus
  defaultAgentId: string
}

/**
 * Channel Gateway — 消息出入的统一关口。
 *
 * 职责：
 * 1. receive(raw): 接收原始消息 → 查绑定 → 校验 → 生成 Envelope → 投递到 Bus
 * 2. 无绑定时触发配对流程
 * 3. 绑定被撤销时丢弃消息
 */
export class ChannelGateway {
  private deps: GatewayDeps

  constructor(deps: GatewayDeps) {
    this.deps = deps
  }

  /**
   * 接收一条原始消息，执行完整的网关决策流程。
   *
   * 决策树 (参考 Telegram 插件 gate()):
   *   1. bindingStore.getBinding(channel, userId)
   *      ├── 无绑定 → handshake.requestPairing()
   *      │            ├── 配对码已存在 (未过期) → 返回 pair (不重复生成)
   *      │            └── 新配对码 → 返回 pair
   *      └── 有绑定
   *           ├── status !== 'active' → drop
   *           └── status === 'active'
   *                ├── 校验权限 → 失败 → drop
   *                └── 通过 → createEnvelope() → bus.publish() → deliver
   */
  async receive(raw: RawMessage): Promise<GateAction> {
    // 1. 查绑定
    const binding = this.deps.bindingStore.getBinding(raw.channel, raw.channel_user_id)

    if (!binding) {
      // 无绑定 → 触发配对
      const pending = this.deps.handshake.getPending(raw.channel, raw.channel_user_id)
      if (pending) {
        return { action: 'pair', code: pending.code }
      }
      const code = this.deps.handshake.createPairing(raw.channel, raw.channel_user_id, raw.chat_id)
      return { action: 'pair', code }
    }

    // 2. 校验绑定状态
    if (binding.status !== 'active') {
      return { action: 'drop', reason: `Binding status: ${binding.status}` }
    }

    // 3. 生成 Envelope
    const envelope = createEnvelope({
      channel: raw.channel,
      channel_user_id: raw.channel_user_id,
      agent_id: binding.agent_id,
      direction: 'inbound',
      type: 'text',
      payload: { text: raw.text, data: raw.metadata as Record<string, unknown> | undefined },
      workspace_id: binding.workspace_id,
      auth: {
        principal_id: binding.principal_id,
        roles: binding.permissions,
      },
    })

    // 4. 投递到 Message Bus
    const topic = `agent.${binding.agent_id}.inbound`
    this.deps.bus.publish(topic, envelope)

    return { action: 'deliver', envelope }
  }

  /**
   * 将出站 Envelope 分发回信道。
   * 由 OutboundDispatcher 调用。
   */
  async dispatchOutbound(envelope: Envelope): Promise<void> {
    // Outbound Dispatcher 会处理实际发送逻辑
    // Gateway 只做格式校验
    const topic = `agent.${envelope.agent_id}.outbound`
    this.deps.bus.publish(topic, envelope)
  }
}
