/**
 * AgentGate — Conversation Store
 *
 * 按 conversation_id 持久化消息历史。每个 conversation 存为独立的 JSON 文件。
 * 路径: ~/.agentgate/conversations/{conversation_id}.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, unlinkSync } from 'fs'
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

  constructor(agentId?: string) {
    const baseDir = agentId
      ? join(BASE_DIR, agentId)
      : BASE_DIR
    this.convDir = join(baseDir, 'conversations')
    // 迁移旧路径数据到新 agent 子目录
    if (agentId) {
      this.migrateFromBaseDir()
    }
  }

  /** 将 ~/.agentgate/conversations/ 中的旧对话迁移到 agent 子目录 */
  private migrateFromBaseDir(): void {
    const oldConvDir = join(BASE_DIR, 'conversations')
    try {
      if (!existsSync(oldConvDir)) return
      mkdirSync(this.convDir, { recursive: true })
      const files = readdirSync(oldConvDir)
      let migrated = 0
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        const oldPath = join(oldConvDir, f)
        const newPath = join(this.convDir, f)
        if (existsSync(newPath)) continue // 新路径已有，跳过
        try {
          const content = readFileSync(oldPath, 'utf8')
          writeFileSync(newPath, content)
          unlinkSync(oldPath)
          migrated++
        } catch {
          // 跳过无法迁移的文件
        }
      }
      if (migrated > 0) {
        console.error(`[ConversationStore] Migrated ${migrated} conversations to ${this.convDir}`)
      }
    } catch {
      // 迁移失败不阻塞启动
    }
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

  /** 原子写入：先写临时文件，再 rename，崩溃安全 */
  private saveConversation(id: string, messages: MessageRecord[]): void {
    mkdirSync(this.convDir, { recursive: true })
    const targetPath = this.convPath(id)
    const tmpPath = targetPath + '.tmp'
    const content = JSON.stringify(messages, null, 2)

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        writeFileSync(tmpPath, content)
        renameSync(tmpPath, targetPath)
        return
      } catch (err) {
        if (attempt === 3) {
          console.error(`[ConversationStore] Failed to save ${id} after 3 attempts: ${err}`)
          throw err
        }
        // 短暂延迟后重试（同步忙等待，在文件系统竞争场景下足够）
        const start = Date.now()
        while (Date.now() - start < attempt * 5) { /* spin */ }
      }
    }
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

  /** 追加一条消息到对话（自动去重） */
  appendMessage(msg: MessageRecord): void {
    const messages = this.loadMessages(msg.conversation_id)
    // 去重：相同 message_id 已在对话中则跳过
    if (messages.some(m => m.message_id === msg.message_id)) {
      console.warn(`[ConversationStore] Skipping duplicate message: ${msg.message_id}`)
      return
    }
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

  /** 更新消息文本（用于编辑）返回是否成功 */
  updateMessage(convId: string, messageId: string, text: string): boolean {
    const messages = this.loadMessages(convId)
    const msg = messages.find(m => m.message_id === messageId)
    if (!msg) return false
    // 保存编辑历史
    const editEntry = { text: msg.text, edited_at: new Date().toISOString() }
    const editHistory = (msg.metadata?.edit_history as Array<{text: string; edited_at: string}> | undefined) ?? []
    editHistory.push(editEntry)
    msg.text = text
    msg.metadata = { ...msg.metadata, edited: true, edited_at: new Date().toISOString(), edit_history: editHistory }
    this.saveConversation(convId, messages)
    // 更新索引中的最后活跃时间
    const summary = this.index.get(convId)
    if (summary) {
      summary.last_active_at = new Date().toISOString()
      this.index.set(convId, summary)
    }
    return true
  }

  /** 给消息添加表情反应 */
  addReaction(convId: string, messageId: string, emoji: string, agentId: string): boolean {
    const messages = this.loadMessages(convId)
    const msg = messages.find(m => m.message_id === messageId)
    if (!msg) return false
    const reactions = (msg.metadata?.reactions as Record<string, string[]> | undefined) ?? {}
    if (!reactions[emoji]) reactions[emoji] = []
    if (!reactions[emoji].includes(agentId)) {
      reactions[emoji].push(agentId)
    }
    msg.metadata = { ...msg.metadata, reactions }
    this.saveConversation(convId, messages)
    return true
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
