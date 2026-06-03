/**
 * AgentGate — Session Registry
 *
 * 管理消息会话的生命周期。每个 (agent_id, channel_user_id) 组合
 * 对应一个会话，用于追踪对话上下文和消息计数。
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import type { SessionInfo, ChannelType } from '../types.js'

const AGENTGATE_DIR = process.env.AGENTGATE_DIR ?? join(homedir(), '.agentgate')
const SESSIONS_FILE = join(AGENTGATE_DIR, 'sessions.json')

function generateSessionId(): string {
  return `sess_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
}

export class SessionRegistry {
  private cache: SessionInfo[] | null = null

  private load(): SessionInfo[] {
    if (this.cache) return this.cache
    try {
      const raw = readFileSync(SESSIONS_FILE, 'utf8')
      this.cache = JSON.parse(raw) as SessionInfo[]
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = []
      } else {
        console.error(`[SessionRegistry] Failed to load: ${err}`)
        this.cache = []
      }
    }
    return this.cache!
  }

  private save(): void {
    mkdirSync(AGENTGATE_DIR, { recursive: true })
    try {
      writeFileSync(SESSIONS_FILE, JSON.stringify(this.cache, null, 2))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[SessionRegistry] Save failed (retrying): ${msg}`)
      try {
        writeFileSync(SESSIONS_FILE, JSON.stringify(this.cache, null, 2))
      } catch {}
    }
  }

  /** 查找或创建会话 */
  getOrCreate(agentId: string, channel: ChannelType, channelUserId: string): SessionInfo {
    this.load()
    const existing = this.cache!.find(
      s => s.agent_id === agentId && s.channel === channel && s.channel_user_id === channelUserId,
    )
    if (existing) {
      existing.last_active_at = new Date().toISOString()
      existing.message_count++
      this.save()
      return existing
    }

    const now = new Date().toISOString()
    const session: SessionInfo = {
      session_id: generateSessionId(),
      agent_id: agentId,
      channel,
      channel_user_id: channelUserId,
      conversation_id: `conv_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`,
      created_at: now,
      last_active_at: now,
      message_count: 1,
    }
    this.cache!.push(session)
    this.save()
    return session
  }

  /** 按 ID 获取会话 */
  getById(sessionId: string): SessionInfo | undefined {
    return this.load().find(s => s.session_id === sessionId)
  }

  /** 关闭会话 */
  closeSession(sessionId: string): void {
    this.load()
    this.cache = this.cache!.filter(s => s.session_id !== sessionId)
    this.save()
  }

  /** 列出某 agent 的活跃会话 */
  listByAgent(agentId: string): SessionInfo[] {
    return this.load().filter(s => s.agent_id === agentId)
  }

  /** 列出所有活跃会话 */
  listAll(): SessionInfo[] {
    return this.load()
  }
}
