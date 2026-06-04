/**
 * AgentGate — 广播信道适配器
 *
 * 提供进程内广播能力。发送到 `_broadcast` topic 的消息被所有订阅者收到。
 *
 * 用途:
 *   - 一个 adapter 发消息，其他 adapter 都能收到（如通知所有 Telegram Bot）
 *   - 系统级通知推送到所有已连接的信道
 *   - 跨 agent 全局事件
 *
 * 防回环: 通过 seenIds Set 追踪已处理消息 ID，避免 A→B→A 死循环。
 */
import type { ChannelAdapter, MessageCallback } from './base.js'
import type { ChannelType, RawMessage, Envelope } from '../types.js'
import type { MessageBus } from '../bus/memory_bus.js'

const BROADCAST_TOPIC = '_broadcast'
const MAX_SEEN_IDS = 10_000

export class BroadcastAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'broadcast'
  private bus: MessageBus
  private callback: MessageCallback | null = null
  private running = false
  private seenIds: Set<string> = new Set()

  constructor(bus: MessageBus) {
    this.bus = bus
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    // 订阅广播 topic：收到广播消息 → 转给 gateway
    this.bus.subscribeWildcard(BROADCAST_TOPIC, (envelope: Envelope) => {
      if (!this.callback || !this.running) return

      const msgId = envelope.message_id
      if (!msgId) return
      if (this.seenIds.has(msgId)) return
      this.seenIds.add(msgId)
      if (this.seenIds.size > MAX_SEEN_IDS) this.seenIds.clear()

      this.callback({
        channel: 'broadcast',
        channel_user_id: envelope.channel_user_id || '_broadcast',
        chat_id: `broadcast:${envelope.channel_user_id || '_system'}`,
        text: envelope.payload.text ?? '',
        message_id: msgId,
      })
    })

    console.error('[Broadcast] Listening on _broadcast')
  }

  async stop(): Promise<void> {
    this.running = false
  }

  async send(envelope: Envelope): Promise<void> {
    if (!this.running) return
    // 发布到广播 topic
    this.bus.publish(BROADCAST_TOPIC, envelope)
  }

  onMessage(callback: MessageCallback): void {
    this.callback = callback
  }
}
