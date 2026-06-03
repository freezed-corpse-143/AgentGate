/**
 * AgentGate — Outbound Dispatcher
 *
 * 将 Agent 的出站回复通过正确的信道适配器发送出去。
 * 订阅 agent.*.outbound topic，按 envelope.channel 找到对应的
 * ChannelAdapter 并调用 send()。
 */
import type { Envelope, ChannelType } from '../types.js'
import type { MessageBus } from '../bus/memory_bus.js'
import type { ChannelAdapter } from '../channels/base.js'

export class OutboundDispatcher {
  private adapters: Map<ChannelType, ChannelAdapter> = new Map()

  constructor(adapters: ChannelAdapter[]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.channelType, adapter)
    }
  }

  /** 注册到 Message Bus */
  attach(bus: MessageBus): void {
    bus.subscribeWildcard('agent.*.outbound', async (envelope, topic) => {
      await this.dispatch(envelope)
    })
    console.log('[Dispatcher] Attached to bus — listening on agent.*.outbound')
  }

  /** 分发一条出站 Envelope */
  async dispatch(envelope: Envelope): Promise<void> {
    const adapter = this.adapters.get(envelope.channel)
    if (!adapter) {
      console.warn(`[Dispatcher] No adapter for channel: ${envelope.channel}`)
      return
    }

    try {
      await adapter.send(envelope)
      console.log(`[Dispatcher] Dispatched ${envelope.message_id} → ${envelope.channel}`)
    } catch (err) {
      console.error(`[Dispatcher] Failed to dispatch ${envelope.message_id}: ${err}`)
    }
  }

  /** 运行时注册新适配器 */
  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.channelType, adapter)
  }
}
