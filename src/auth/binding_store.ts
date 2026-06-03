/**
 * AgentGate — 绑定存储
 *
 * 管理信道用户 ↔ Agent 的绑定关系。存储格式为 JSON 文件，
 * 路径: ~/.agentgate/bindings.json
 *
 * 参考 Telegram 插件的 access.json 管理机制 (ACCESS.md)。
 * 绑定表的 SQL schema 见 guide.md §4.2。
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import type { ChannelBinding, ChannelType, BindingStatus } from '../types.js'

const AGENTGATE_DIR = process.env.AGENTGATE_DIR ?? join(homedir(), '.agentgate')
const BINDINGS_FILE = join(AGENTGATE_DIR, 'bindings.json')

function generateBindingId(): string {
  return `bind_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
}

export class BindingStore {
  private cache: ChannelBinding[] | null = null

  private load(): ChannelBinding[] {
    if (this.cache) return this.cache
    try {
      const raw = readFileSync(BINDINGS_FILE, 'utf8')
      this.cache = JSON.parse(raw) as ChannelBinding[]
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = []
      } else {
        console.error(`[BindingStore] Failed to load bindings: ${err}`)
        this.cache = []
      }
    }
    return this.cache!
  }

  private save(): void {
    mkdirSync(AGENTGATE_DIR, { recursive: true })
    try {
      writeFileSync(BINDINGS_FILE, JSON.stringify(this.cache, null, 2))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[BindingStore] Save failed (retrying): ${msg}`)
      try { writeFileSync(BINDINGS_FILE, JSON.stringify(this.cache, null, 2)) } catch {}
    }
  }

  /** 查询绑定：按信道类型 + 用户 ID */
  getBinding(channel: ChannelType, channelUserId: string): ChannelBinding | undefined {
    return this.load().find(
      b => b.channel_type === channel && b.channel_user_id === channelUserId && b.status === 'active',
    )
  }

  /** 查询绑定：按绑定 ID */
  getById(id: string): ChannelBinding | undefined {
    return this.load().find(b => b.id === id)
  }

  /** 创建新绑定 */
  createBinding(binding: Omit<ChannelBinding, 'id' | 'created_at' | 'last_seen_at'>): ChannelBinding {
    const now = new Date().toISOString()
    const newBinding: ChannelBinding = {
      ...binding,
      id: generateBindingId(),
      created_at: now,
      last_seen_at: now,
    }
    this.load().push(newBinding)
    this.save()
    return newBinding
  }

  /** 更新最后活动时间 */
  updateLastSeen(id: string): void {
    const binding = this.getById(id)
    if (binding) {
      binding.last_seen_at = new Date().toISOString()
      this.save()
    }
  }

  /** 撤销绑定 */
  revokeBinding(id: string): void {
    const binding = this.getById(id)
    if (binding) {
      binding.status = 'revoked'
      this.save()
    }
  }

  /** 列出所有活跃绑定 */
  listActive(): ChannelBinding[] {
    return this.load().filter(b => b.status === 'active')
  }

  /** 列出特定信道的所有绑定 */
  listByChannel(channel: ChannelType): ChannelBinding[] {
    return this.load().filter(b => b.channel_type === channel)
  }
}
