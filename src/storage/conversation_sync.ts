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

    // 2. 监听本地 edit → 广播（先标记再发布，防同进程回环）
    this.store.onEdit = (convId, messageId, text) => {
      if (!this.enabled) return
      const dedupKey = `edit:${messageId}`
      this.syncedIds.set(dedupKey, Date.now())
      this.cleanup()
      this.bus.publish(SYNC_TOPIC, {
        message_id: messageId,
        trace_id: `sync_${Date.now().toString(36)}`,
        channel: 'agentgate' as const,
        channel_user_id: 'system',
        agent_id: 'system',
        conversation_id: convId,
        direction: 'inbound' as const,
        type: 'system_alert' as const,
        payload: {
          text,
          data: {
            _sync: true,
            _sync_type: 'edit',
            message_id: messageId,
            conversation_id: convId,
            text,
            timestamp: new Date().toISOString(),
          },
        },
        timestamp: new Date().toISOString(),
      })
    }

    // 3. 监听本地 reaction → 广播（先标记再发布，防同进程回环）
    this.store.onReaction = (convId, messageId, emoji, agentId) => {
      if (!this.enabled) return
      const dedupKey = `reaction:${messageId}:${emoji}:${agentId}`
      this.syncedIds.set(dedupKey, Date.now())
      this.cleanup()
      this.bus.publish(SYNC_TOPIC, {
        message_id: messageId,
        trace_id: `sync_${Date.now().toString(36)}`,
        channel: 'agentgate' as const,
        channel_user_id: agentId,
        agent_id: 'system',
        conversation_id: convId,
        direction: 'inbound' as const,
        type: 'system_alert' as const,
        payload: {
          text: emoji,
          data: {
            _sync: true,
            _sync_type: 'reaction',
            message_id: messageId,
            conversation_id: convId,
            emoji,
            agent_id: agentId,
            timestamp: new Date().toISOString(),
          },
        },
        timestamp: new Date().toISOString(),
      })
    }

    // 4. 监听远端同步消息 → 追加/编辑/反应到本地
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

  /** 收到远端同步消息 → 追加/编辑/反应到本地 */
  private handleRemoteSync(envelope: any): void {
    if (!this.enabled) return

    const data = envelope.payload?.data
    if (!data?._sync) return

    const msgId = data.message_id as string
    if (!msgId) return

    const syncType = (data._sync_type as string) ?? 'message'
    const dedupKey = `${syncType}:${msgId}`

    // 防止重复处理
    if (this.syncedIds.has(dedupKey)) return
    this.syncedIds.set(dedupKey, Date.now())
    this.cleanup()

    switch (syncType) {
      case 'edit': {
        // 远端编辑 → 本地更新
        const editConvId = data.conversation_id as string
        const editText = data.text as string
        this.store.updateMessage(editConvId, msgId, editText)
        break
      }
      case 'reaction': {
        // 远端反应 → 本地添加
        const rConvId = data.conversation_id as string
        const rEmoji = data.emoji as string
        const rAgentId = data.agent_id as string
        this.store.addReaction(rConvId, msgId, rEmoji, rAgentId)
        break
      }
      default: {
        // 远端新消息 → 追加到本地
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
        this.store.appendMessage(record)
      }
    }
  }

  /** 停止同步 */
  stop(): void {
    this.enabled = false
    this.store.onAppend = null
    this.store.onEdit = null
    this.store.onReaction = null
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
