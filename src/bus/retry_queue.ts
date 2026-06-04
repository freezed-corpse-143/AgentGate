/**
 * AgentGate — 断点重试队列
 *
 * 当 P2P 投递失败时（peer 离线、socket 不可写），
 * 消息进入重试队列，等待 peer 重连后自动重发。
 *
 * 设计:
 *   - 按 target_agent_id 分桶，互不干扰
 *   - 指数退避: 1s → 2s → 4s → 8s → ... → 60s max
 *   - 最大重试次数后进入死信
 *   - drain() 在 peer 重连时立即清空该 peer 的队列
 */
import type { Envelope } from '../types.js'

// ─── 常量 ──────────────────────────────────────────

const INITIAL_RETRY_MS = 1_000
const MAX_RETRY_MS = 60_000
const BACKOFF_FACTOR = 2
const MAX_RETRIES = 8
const DRAIN_INTERVAL_MS = 2_000

// ─── 类型 ──────────────────────────────────────────

interface PendingMessage {
  envelope: Envelope
  targetAgentId: string
  topic: string
  attempt: number
  nextRetryAt: number
}

export type PeerSocketGetter = (agentId: string) => { write(data: Buffer): boolean } | null

export interface RetryQueueOptions {
  /** 获取 peer socket 的回调，由 BridgeAgent 提供 */
  getPeerSocket: PeerSocketGetter
  /** 消息序列化回调（默认 JSON.stringify + \n） */
  encode?: (envelope: Envelope, topic: string) => Buffer
}

// ─── RetryQueue ─────────────────────────────────────

export class RetryQueue {
  private queue: Map<string, PendingMessage[]> = new Map()
  private getPeerSocket: PeerSocketGetter
  private encode: (envelope: Envelope, topic: string) => Buffer
  private drainTimer: ReturnType<typeof setInterval> | null = null
  private running = false
  public onDeadLetter: ((envelope: Envelope, targetAgentId: string, reason: string) => void) | null = null

  constructor(opts: RetryQueueOptions) {
    this.getPeerSocket = opts.getPeerSocket
    this.encode = opts.encode ?? this.defaultEncode
  }

  /** 启动重试定时器 */
  start(): void {
    if (this.running) return
    this.running = true
    this.drainTimer = setInterval(() => this.tick(), DRAIN_INTERVAL_MS)
    console.error('[RetryQueue] Started')
  }

  /** 停止重试定时器 */
  stop(): void {
    this.running = false
    if (this.drainTimer) {
      clearInterval(this.drainTimer)
      this.drainTimer = null
    }
    this.queue.clear()
  }

  /** 入队一条发送失败的消息 */
  enqueue(envelope: Envelope, targetAgentId: string, topic: string): void {
    if (!this.running) return

    // 如果已经有一条相同的 message_id 在队列中，跳过
    const existing = this.queue.get(targetAgentId)
    if (existing?.some(m => m.envelope.message_id === envelope.message_id)) return

    const msg: PendingMessage = {
      envelope,
      targetAgentId,
      topic,
      attempt: 0,
      nextRetryAt: Date.now() + INITIAL_RETRY_MS,
    }

    if (!this.queue.has(targetAgentId)) {
      this.queue.set(targetAgentId, [])
    }
    this.queue.get(targetAgentId)!.push(msg)
    console.error(`[RetryQueue] Enqueued ${envelope.message_id} → ${targetAgentId} (queue depth: ${this.queue.get(targetAgentId)!.length})`)
  }

  /** peer 重连时立即清空其队列 */
  drain(targetAgentId: string): number {
    const msgs = this.queue.get(targetAgentId)
    if (!msgs || msgs.length === 0) return 0

    const socket = this.getPeerSocket(targetAgentId)
    if (!socket) return 0

    const sent: PendingMessage[] = []
    const remaining: PendingMessage[] = []

    for (const msg of msgs) {
      try {
        socket.write(this.encode(msg.envelope, msg.topic))
        sent.push(msg)
      } catch {
        // 仍然写失败，重新安排重试
        msg.attempt++
        msg.nextRetryAt = Date.now() + this.backoff(msg.attempt)
        remaining.push(msg)
      }
    }

    if (remaining.length > 0) {
      this.queue.set(targetAgentId, remaining)
    } else {
      this.queue.delete(targetAgentId)
    }

    if (sent.length > 0) {
      console.error(`[RetryQueue] Drained ${sent.length} msgs → ${targetAgentId}`)
    }
    return sent.length
  }

  /** 当前待重试消息数 */
  get pendingCount(): number {
    let count = 0
    for (const msgs of this.queue.values()) {
      count += msgs.length
    }
    return count
  }

  /** 默认序列化：JSON line */
  private defaultEncode(envelope: Envelope, topic: string): Buffer {
    return Buffer.from(JSON.stringify({ type: 'message', topic, envelope }) + '\n', 'utf8')
  }

  // ─── 内部 ──────────────────────────────────────

  /** 定时器触发：检查所有队列中到期的消息 */
  private tick(): void {
    const now = Date.now()
    for (const [agentId, msgs] of this.queue.entries()) {
      if (msgs.length === 0) {
        this.queue.delete(agentId)
        continue
      }

      const socket = this.getPeerSocket(agentId)
      if (!socket) continue // peer 仍离线，等下次

      const remaining: PendingMessage[] = []
      for (const msg of msgs) {
        if (msg.nextRetryAt > now) {
          remaining.push(msg)
          continue
        }

        try {
          socket.write(this.encode(msg.envelope, msg.topic))
          // 发送成功，不加入 remaining
          console.error(`[RetryQueue] Retry OK ${msg.envelope.message_id} → ${agentId}`)
        } catch {
          msg.attempt++
          if (msg.attempt >= MAX_RETRIES) {
            console.error(`[RetryQueue] DEAD LETTER ${msg.envelope.message_id} → ${agentId} (${MAX_RETRIES} attempts exhausted)`)
            this.onDeadLetter?.(msg.envelope, agentId, `max retries (${MAX_RETRIES}) exceeded`)
            continue // 丢弃
          }
          msg.nextRetryAt = now + this.backoff(msg.attempt)
          remaining.push(msg)
        }
      }

      if (remaining.length > 0) {
        this.queue.set(agentId, remaining)
      } else {
        this.queue.delete(agentId)
      }
    }
  }

  /** 指数退避计算 */
  private backoff(attempt: number): number {
    return Math.min(INITIAL_RETRY_MS * Math.pow(BACKOFF_FACTOR, attempt), MAX_RETRY_MS)
  }
}
