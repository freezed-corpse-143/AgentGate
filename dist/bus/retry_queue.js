// ─── 常量 ──────────────────────────────────────────
const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;
const BACKOFF_FACTOR = 2;
const MAX_RETRIES = 8;
const DRAIN_INTERVAL_MS = 2_000;
// ─── RetryQueue ─────────────────────────────────────
export class RetryQueue {
    queue = new Map();
    getPeerSocket;
    encode;
    drainTimer = null;
    running = false;
    onDeadLetter = null;
    constructor(opts) {
        this.getPeerSocket = opts.getPeerSocket;
        this.encode = opts.encode ?? this.defaultEncode;
    }
    /** 启动重试定时器 */
    start() {
        if (this.running)
            return;
        this.running = true;
        this.drainTimer = setInterval(() => this.tick(), DRAIN_INTERVAL_MS);
        console.error('[RetryQueue] Started');
    }
    /** 停止重试定时器 */
    stop() {
        this.running = false;
        if (this.drainTimer) {
            clearInterval(this.drainTimer);
            this.drainTimer = null;
        }
        this.queue.clear();
    }
    /** 入队一条发送失败的消息 */
    enqueue(envelope, targetAgentId, topic) {
        if (!this.running)
            return;
        // 如果已经有一条相同的 message_id 在队列中，跳过
        const existing = this.queue.get(targetAgentId);
        if (existing?.some(m => m.envelope.message_id === envelope.message_id))
            return;
        const msg = {
            envelope,
            targetAgentId,
            topic,
            attempt: 0,
            nextRetryAt: Date.now() + INITIAL_RETRY_MS,
        };
        if (!this.queue.has(targetAgentId)) {
            this.queue.set(targetAgentId, []);
        }
        this.queue.get(targetAgentId).push(msg);
        console.error(`[RetryQueue] Enqueued ${envelope.message_id} → ${targetAgentId} (queue depth: ${this.queue.get(targetAgentId).length})`);
    }
    /** peer 重连时立即清空其队列 */
    drain(targetAgentId) {
        const msgs = this.queue.get(targetAgentId);
        if (!msgs || msgs.length === 0)
            return 0;
        const socket = this.getPeerSocket(targetAgentId);
        if (!socket)
            return 0;
        const sent = [];
        const remaining = [];
        for (const msg of msgs) {
            try {
                socket.write(this.encode(msg.envelope, msg.topic));
                sent.push(msg);
            }
            catch {
                // 仍然写失败，重新安排重试
                msg.attempt++;
                msg.nextRetryAt = Date.now() + this.backoff(msg.attempt);
                remaining.push(msg);
            }
        }
        if (remaining.length > 0) {
            this.queue.set(targetAgentId, remaining);
        }
        else {
            this.queue.delete(targetAgentId);
        }
        if (sent.length > 0) {
            console.error(`[RetryQueue] Drained ${sent.length} msgs → ${targetAgentId}`);
        }
        return sent.length;
    }
    /** 当前待重试消息数 */
    get pendingCount() {
        let count = 0;
        for (const msgs of this.queue.values()) {
            count += msgs.length;
        }
        return count;
    }
    /** 默认序列化：JSON line */
    defaultEncode(envelope, topic) {
        return Buffer.from(JSON.stringify({ type: 'message', topic, envelope }) + '\n', 'utf8');
    }
    // ─── 内部 ──────────────────────────────────────
    /** 定时器触发：检查所有队列中到期的消息 */
    tick() {
        const now = Date.now();
        for (const [agentId, msgs] of this.queue.entries()) {
            if (msgs.length === 0) {
                this.queue.delete(agentId);
                continue;
            }
            const socket = this.getPeerSocket(agentId);
            if (!socket)
                continue; // peer 仍离线，等下次
            const remaining = [];
            for (const msg of msgs) {
                if (msg.nextRetryAt > now) {
                    remaining.push(msg);
                    continue;
                }
                try {
                    socket.write(this.encode(msg.envelope, msg.topic));
                    // 发送成功，不加入 remaining
                    console.error(`[RetryQueue] Retry OK ${msg.envelope.message_id} → ${agentId}`);
                }
                catch {
                    msg.attempt++;
                    if (msg.attempt >= MAX_RETRIES) {
                        console.error(`[RetryQueue] DEAD LETTER ${msg.envelope.message_id} → ${agentId} (${MAX_RETRIES} attempts exhausted)`);
                        this.onDeadLetter?.(msg.envelope, agentId, `max retries (${MAX_RETRIES}) exceeded`);
                        continue; // 丢弃
                    }
                    msg.nextRetryAt = now + this.backoff(msg.attempt);
                    remaining.push(msg);
                }
            }
            if (remaining.length > 0) {
                this.queue.set(agentId, remaining);
            }
            else {
                this.queue.delete(agentId);
            }
        }
    }
    /** 指数退避计算 */
    backoff(attempt) {
        return Math.min(INITIAL_RETRY_MS * Math.pow(BACKOFF_FACTOR, attempt), MAX_RETRY_MS);
    }
}
//# sourceMappingURL=retry_queue.js.map