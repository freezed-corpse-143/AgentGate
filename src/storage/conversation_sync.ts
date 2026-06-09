/**
 * AgentGate — Conversation Sync
 *
 * 跨进程对话记录同步。通过 MessageBus 的 _system.conversation.sync topic
 * 将本地追加的消息广播到其他进程的 ConversationStore。
 *
 * 架构:
 *   Local append → onAppend callback → publish to _system.conversation.sync
 *     → BridgeClient → BridgeServer → 其他 BridgeClient
 *       → 其他进程的 bus → _system.conversation.sync handler
 *         → append to remote ConversationStore
 *
 * 环路避免: 追踪已同步的 message_id，不重复广播。
 */
import type { MessageBus } from '../bus/memory_bus.js'
import type { ConversationStore, MessageRecord } from './conversation_store.js'

// ─── 常量 ──────────────────────────────────────────────────────

const SYNC_TOPIC = '_system.conversation.sync'
const MAX_SEEN_IDS = 10_000
const CLEANUP_INTERVAL_MS = 120_000

// ─── ConversationSync ──────────────────────────────────────────

export interface ConversationSyncOptions {
  /** 是否启用同步（默认 true） */
  enabled?: boolean
}

/**
 * 跨进程对话同步器。挂接到 ConversationStore.onAppend，
 * 将新消息通过 MessageBus 广播到其他进程。
 */
export class ConversationSync {
  private bus: MessageBus
  private store: ConversationStore
  private enabled: boolean
  /** 追踪已从远端同步的 message_id，防止回路。值: 加入时间戳 */
  private syncedIds: Map<string, number> = new Map()
  private lastCleanup: number = Date.now()

  constructor(
    bus: MessageBus,
    store: ConversationStore,
    opts?: ConversationSyncOptions,
  ) {
    this.bus = bus
    this.store = store
    this.enabled = opts?.enabled ?? true

    if (!this.enabled) return

    // 1. 监听本地 append → 广播到其他进程
    this.store.onAppend = (record: MessageRecord) => {
      this.handleLocalAppend(record)
    }

    // 2. 监听远端同步消息 → 追加到本地
    this.bus.subscribeWildcard(SYNC_TOPIC, (envelope: any) => {
      this.handleRemoteSync(envelope)
    })

    console.error('[ConversationSync] Started — listening on _system.conversation.sync')
  }

  /** 本地追加消息 → 广播到远端 */
  private handleLocalAppend(record: MessageRecord): void {
    if (!this.enabled) return

    const msgId = record.message_id
    if (!msgId) return

    // 如果这条消息是自己刚刚从远端同步过来的，跳过
    if (this.syncedIds.has(msgId)) {
      return
    }

    // 先加入 syncedIds 防止本地回环（bus.publish 会触发同进程的 handleRemoteSync）
    this.syncedIds.set(msgId, Date.now())
    this.cleanup()

    // 发布到系统 topic
    this.bus.publish(SYNC_TOPIC, {
      message_id: record.message_id,
      trace_id: record.metadata?.trace_id as string ?? '',
      channel: record.channel,
      channel_user_id: record.channel_user_id,
      agent_id: record.agent_id,
      conversation_id: record.conversation_id,
      direction: 'inbound' as const,
      type: 'system_alert' as const,
      payload: {
        text: record.text,
        data: {
          _sync: true,
          message_id: record.message_id,
          conversation_id: record.conversation_id,
          agent_id: record.agent_id,
          role: record.role,
          text: record.text,
          channel: record.channel,
          channel_user_id: record.channel_user_id,
          timestamp: record.timestamp,
          metadata: record.metadata,
        },
      },
      timestamp: new Date().toISOString(),
    })
  }

  /** 收到远端同步消息 → 追加到本地 */
  private handleRemoteSync(envelope: any): void {
    if (!this.enabled) return

    const data = envelope.payload?.data
    if (!data?._sync) return

    const msgId = data.message_id as string
    if (!msgId) return

    // 防止自身消息被重复处理
    if (this.syncedIds.has(msgId)) return

    // 标记已同步，防止本地 append 时再广播回去
    this.syncedIds.set(msgId, Date.now())
    this.cleanup()

    const record: MessageRecord = {
      message_id: msgId,
      conversation_id: data.conversation_id as string,
      agent_id: data.agent_id as string,
      role: data.role as MessageRecord['role'],
      text: data.text as string,
      channel: data.channel as MessageRecord['channel'],
      channel_user_id: data.channel_user_id as string,
      timestamp: data.timestamp as string,
      metadata: data.metadata as Record<string, unknown> | undefined,
    }

    // 追加到本地 store（会触发 onAppend，但 syncedIds 阻止回环）
    this.store.appendMessage(record)
  }

  /** 停止同步 */
  stop(): void {
    this.enabled = false
    if (this.store.onAppend === this.handleLocalAppend.bind(this)) {
      this.store.onAppend = null
    }
    this.syncedIds.clear()
  }

  /** LRU 淘汰：超过上限时淘汰最旧的一半条目，保留最近的 */
  private cleanup(): void {
    const now = Date.now()
    if (now - this.lastCleanup < CLEANUP_INTERVAL_MS) return
    this.lastCleanup = now

    if (this.syncedIds.size > MAX_SEEN_IDS) {
      // 按时间戳排序，保留最近的一半
      const entries = Array.from(this.syncedIds.entries())
        .sort((a, b) => a[1] - b[1])
      const evictCount = Math.floor(entries.length / 2)
      const evicted = entries.slice(0, evictCount)
      for (const [id] of evicted) {
        this.syncedIds.delete(id)
      }
      console.error(`[ConversationSync] LRU eviction: removed ${evictCount} of ${entries.length} syncedIds`)
    }
  }
}
