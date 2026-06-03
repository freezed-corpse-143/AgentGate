/**
 * AgentGate — Conversation Store
 *
 * 按 conversation_id 持久化消息历史。每个 conversation 存为独立的 JSON 文件。
 * 路径: ~/.agentgate/conversations/{conversation_id}.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ChannelType } from '../types.js'

// ─── 消息记录 ──────────────────────────────────────────────────

export type MessageRole = 'user' | 'agent' | 'system'

export interface MessageRecord {
  message_id: string
  conversation_id: string
  agent_id: string
  role: MessageRole
  text: string
  channel: ChannelType
  channel_user_id: string
  timestamp: string // ISO-8601
  metadata?: Record<string, unknown>
}

// ─── 会话概要 ──────────────────────────────────────────────────

export interface ConversationSummary {
  conversation_id: string
  agent_id: string
  channel: ChannelType
  channel_user_id: string
  message_count: number
  created_at: string
  last_active_at: string
  summary?: string
}

// ─── ConversationStore ─────────────────────────────────────────

const BASE_DIR = process.env.AGENTGATE_DIR ?? join(homedir(), '.agentgate')

export type AppendCallback = (record: MessageRecord) => void

export class ConversationStore {
  private convDir: string
  /** 会话概要索引 (conversation_id → summary) */
  private index: Map<string, ConversationSummary> = new Map()
  private indexLoaded = false
  /** 追加消息时的回调（用于跨进程同步） */
  onAppend: AppendCallback | null = null

  constructor() {
    this.convDir = join(BASE_DIR, 'conversations')
  }

  // ── 内部工具 ──────────────────────────────────────────────

  private convPath(id: string): string {
    // 对 conversation_id 做安全转义
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(this.convDir, `${safe}.json`)
  }

  private loadIndex(): void {
    if (this.indexLoaded) return
    this.indexLoaded = true
    try {
      mkdirSync(this.convDir, { recursive: true })
      const files = readdirSync(this.convDir)
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          const raw = readFileSync(join(this.convDir, f), 'utf8')
          const messages: MessageRecord[] = JSON.parse(raw)
          if (messages.length === 0) continue
          const last = messages[messages.length - 1]
          this.index.set(last.conversation_id, {
            conversation_id: last.conversation_id,
            agent_id: last.agent_id,
            channel: last.channel,
            channel_user_id: last.channel_user_id,
            message_count: messages.length,
            created_at: messages[0].timestamp,
            last_active_at: last.timestamp,
          })
        } catch {
          // 跳过损坏文件
        }
      }
    } catch {
      // 目录不存在等
    }
  }

  private saveConversation(id: string, messages: MessageRecord[]): void {
    mkdirSync(this.convDir, { recursive: true })
    writeFileSync(this.convPath(id), JSON.stringify(messages, null, 2))
  }

  private loadMessages(id: string): MessageRecord[] {
    try {
      const raw = readFileSync(this.convPath(id), 'utf8')
      return JSON.parse(raw) as MessageRecord[]
    } catch {
      return []
    }
  }

  // ── 公开 API ──────────────────────────────────────────────

  /** 追加一条消息到对话 */
  appendMessage(msg: MessageRecord): void {
    const messages = this.loadMessages(msg.conversation_id)
    messages.push(msg)
    this.saveConversation(msg.conversation_id, messages)

    // 更新索引
    this.index.set(msg.conversation_id, {
      conversation_id: msg.conversation_id,
      agent_id: msg.agent_id,
      channel: msg.channel,
      channel_user_id: msg.channel_user_id,
      message_count: messages.length,
      created_at: messages[0]?.timestamp ?? msg.timestamp,
      last_active_at: msg.timestamp,
    })

    // 触发同步回调
    if (this.onAppend) {
      try {
        this.onAppend(msg)
      } catch (err) {
        console.error(`[ConversationStore] onAppend callback error: ${err}`)
      }
    }
  }

  /** 查询对话消息 (按时间正序) */
  getMessages(
    conversationId: string,
    options?: { limit?: number; offset?: number },
  ): MessageRecord[] {
    const messages = this.loadMessages(conversationId)
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? messages.length
    return messages.slice(offset, offset + limit)
  }

  /** 获取会话概要 */
  getConversation(conversationId: string): ConversationSummary | undefined {
    this.loadIndex()
    return this.index.get(conversationId)
  }

  /** 列出所有会话 (按最后活跃时间降序) */
  listConversations(agentId?: string): ConversationSummary[] {
    this.loadIndex()
    const all = Array.from(this.index.values())
    const filtered = agentId
      ? all.filter(c => c.agent_id === agentId)
      : all
    return filtered.sort(
      (a, b) => new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime(),
    )
  }

  /** 删除会话 */
  deleteConversation(conversationId: string): boolean {
    this.loadIndex()
    const existed = this.index.delete(conversationId)
    try {
      const path = this.convPath(conversationId)
      if (existsSync(path)) {
        const { unlinkSync } = require('fs') as typeof import('fs')
        unlinkSync(path)
      }
    } catch {}
    return existed
  }
}
