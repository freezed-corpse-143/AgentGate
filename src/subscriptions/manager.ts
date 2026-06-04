/**
 * AgentGate — 订阅管理器
 *
 * 允许外部用户订阅 topic 模式，当匹配的 Envelope 经过 Bus 时
 * 自动推送给订阅者（通过指定信道发送通知）。
 *
 * 使用场景:
 *   - 用户订阅 "agent.*.inbound" → 所有 agent 入站消息推送给用户
 *   - 用户订阅 "agent.agent-alpha.outbound" → 特定 agent 回复推送给用户
 *   - 系统订阅 "_broadcast" → 所有广播通知推送给管理信道
 */
import type { MessageBus } from '../bus/memory_bus.js'
import type { Envelope } from '../types.js'
import type { ChannelAdapter } from '../channels/base.js'

// ─── 类型 ──────────────────────────────────────────

export interface Subscription {
  id: string
  /** 订阅者标识（如 telegram 的 chat_id） */
  subscriberId: string
  /** 推送目标信道类型 */
  channel: string
  /** topic 模式（glob，支持 * 通配符） */
  topicPattern: string
  /** 可选过滤条件 */
  label?: string
  createdAt: string
}

export interface SubscriptionManagerOptions {
  bus: MessageBus
  /** 获取适配器列表的回调（用于推送通知） */
  getAdapters: () => ChannelAdapter[]
}

// ─── SubscriptionManager ───────────────────────────

export class SubscriptionManager {
  private bus: MessageBus
  private getAdapters: () => ChannelAdapter[]
  private subscriptions: Map<string, Subscription> = new Map()
  private running = false
  private nextId = 1

  constructor(opts: SubscriptionManagerOptions) {
    this.bus = opts.bus
    this.getAdapters = opts.getAdapters
  }

  /** 启动：订阅所有 topic 进行匹配 */
  start(): void {
    if (this.running) return
    this.running = true

    this.bus.subscribeWildcard('*', (envelope: Envelope) => {
      this.matchAndDeliver(envelope)
    })

    console.error('[SubscriptionManager] Started')
  }

  /** 停止 */
  stop(): void {
    this.running = false
  }

  /** 创建订阅 */
  subscribe(subscriberId: string, channel: string, topicPattern: string, label?: string): Subscription {
    const sub: Subscription = {
      id: `sub_${this.nextId++}_${Date.now().toString(36)}`,
      subscriberId,
      channel,
      topicPattern,
      label,
      createdAt: new Date().toISOString(),
    }
    this.subscriptions.set(sub.id, sub)
    console.error(`[SubscriptionManager] Subscribed ${subscriberId} → "${topicPattern}" (${sub.id})`)
    return sub
  }

  /** 取消订阅 */
  unsubscribe(subscriptionId: string): boolean {
    const existed = this.subscriptions.delete(subscriptionId)
    if (existed) console.error(`[SubscriptionManager] Unsubscribed ${subscriptionId}`)
    return existed
  }

  /** 列出某用户的所有订阅 */
  listBySubscriber(subscriberId: string): Subscription[] {
    return Array.from(this.subscriptions.values()).filter(s => s.subscriberId === subscriberId)
  }

  /** 列出所有订阅 */
  listAll(): Subscription[] {
    return Array.from(this.subscriptions.values())
  }

  /** 按 ID 查找 */
  get(id: string): Subscription | undefined {
    return this.subscriptions.get(id)
  }

  /** 当前订阅总数 */
  get count(): number {
    return this.subscriptions.size
  }

  // ─── 内部 ──────────────────────────────────────

  /** 匹配所有订阅，推送匹配的 Envelope */
  private matchAndDeliver(envelope: Envelope): void {
    if (!this.running) return

    for (const sub of this.subscriptions.values()) {
      if (!this.matchTopic(sub.topicPattern, envelope)) continue

      // 找到匹配的信道适配器
      const adapter = this.getAdapters().find(a => a.channelType === sub.channel)
      if (!adapter) continue

      // 构造通知 Envelope
      const notification: Envelope = {
        message_id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        trace_id: envelope.trace_id,
        channel: sub.channel as any,
        channel_user_id: sub.subscriberId,
        agent_id: envelope.agent_id,
        conversation_id: envelope.conversation_id,
        direction: 'outbound',
        type: 'text',
        payload: {
          text: `[${sub.label || '订阅通知'}] ${envelope.payload.text || '(empty)'}`,
          data: {
            subscription_id: sub.id,
            original_envelope: envelope,
          },
        },
        timestamp: new Date().toISOString(),
      }

      adapter.send(notification).catch(() => {})
    }
  }

  /** topic 通配符匹配 */
  private matchTopic(pattern: string, envelope: Envelope): boolean {
    // 尝试匹配 topic 名（从 conversation_id 或 channel 推断）
    // 支持: agent.*.inbound → agent.alpha.inbound 匹配
    const targets = [
      `agent.${envelope.agent_id}.inbound`,
      `agent.${envelope.agent_id}.outbound`,
      `_broadcast`,
      envelope.channel,
    ]

    for (const target of targets) {
      if (this.globMatch(pattern, target)) return true
    }
    return false
  }

  /** 简单的 glob 匹配（只支持 *） */
  private globMatch(pattern: string, target: string): boolean {
    const patternParts = pattern.split('.')
    const targetParts = target.split('.')
    if (patternParts.length !== targetParts.length && !pattern.includes('*')) return false

    // 如果 pattern 不含 .，按字符串匹配
    if (!pattern.includes('.') && !pattern.includes('*')) {
      return pattern === target
    }

    // 按段匹配
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '*') continue
      if (i >= targetParts.length) return false
      if (patternParts[i] !== targetParts[i]) return false
    }
    return patternParts.length >= targetParts.length
  }
}
