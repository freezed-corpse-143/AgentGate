// ─── SubscriptionManager ───────────────────────────
export class SubscriptionManager {
    bus;
    getAdapters;
    subscriptions = new Map();
    running = false;
    nextId = 1;
    constructor(opts) {
        this.bus = opts.bus;
        this.getAdapters = opts.getAdapters;
    }
    /** 启动：订阅所有 topic 进行匹配 */
    start() {
        if (this.running)
            return;
        this.running = true;
        this.bus.subscribeWildcard('*', (envelope) => {
            this.matchAndDeliver(envelope);
        });
        console.error('[SubscriptionManager] Started');
    }
    /** 停止 */
    stop() {
        this.running = false;
    }
    /** 创建订阅 */
    subscribe(subscriberId, channel, topicPattern, label) {
        const sub = {
            id: `sub_${this.nextId++}_${Date.now().toString(36)}`,
            subscriberId,
            channel,
            topicPattern,
            label,
            createdAt: new Date().toISOString(),
        };
        this.subscriptions.set(sub.id, sub);
        console.error(`[SubscriptionManager] Subscribed ${subscriberId} → "${topicPattern}" (${sub.id})`);
        return sub;
    }
    /** 取消订阅 */
    unsubscribe(subscriptionId) {
        const existed = this.subscriptions.delete(subscriptionId);
        if (existed)
            console.error(`[SubscriptionManager] Unsubscribed ${subscriptionId}`);
        return existed;
    }
    /** 列出某用户的所有订阅 */
    listBySubscriber(subscriberId) {
        return Array.from(this.subscriptions.values()).filter(s => s.subscriberId === subscriberId);
    }
    /** 列出所有订阅 */
    listAll() {
        return Array.from(this.subscriptions.values());
    }
    /** 按 ID 查找 */
    get(id) {
        return this.subscriptions.get(id);
    }
    /** 当前订阅总数 */
    get count() {
        return this.subscriptions.size;
    }
    // ─── 内部 ──────────────────────────────────────
    /** 匹配所有订阅，推送匹配的 Envelope */
    matchAndDeliver(envelope) {
        if (!this.running)
            return;
        for (const sub of this.subscriptions.values()) {
            if (!this.matchTopic(sub.topicPattern, envelope))
                continue;
            // 找到匹配的信道适配器
            const adapter = this.getAdapters().find(a => a.channelType === sub.channel);
            if (!adapter)
                continue;
            // 构造通知 Envelope
            const notification = {
                message_id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                trace_id: envelope.trace_id,
                channel: sub.channel,
                channel_user_id: sub.subscriberId,
                agent_id: envelope.agent_id,
                conversation_id: envelope.conversation_id,
                direction: 'outbound',
                type: 'text',
                payload: {
                    text: `[${sub.label || '订阅通知'}] ${envelope.payload.text || '(empty)'}`,
                    data: {
                        subscription_id: sub.id,
                        original_envelope: envelope,
                    },
                },
                timestamp: new Date().toISOString(),
            };
            adapter.send(notification).catch(() => { });
        }
    }
    /** topic 通配符匹配 */
    matchTopic(pattern, envelope) {
        // 尝试匹配 topic 名（从 conversation_id 或 channel 推断）
        // 支持: agent.*.inbound → agent.alpha.inbound 匹配
        const targets = [
            `agent.${envelope.agent_id}.inbound`,
            `agent.${envelope.agent_id}.outbound`,
            `_broadcast`,
            envelope.channel,
        ];
        for (const target of targets) {
            if (this.globMatch(pattern, target))
                return true;
        }
        return false;
    }
    /** 简单的 glob 匹配（只支持 *） */
    globMatch(pattern, target) {
        const patternParts = pattern.split('.');
        const targetParts = target.split('.');
        if (patternParts.length !== targetParts.length && !pattern.includes('*'))
            return false;
        // 如果 pattern 不含 .，按字符串匹配
        if (!pattern.includes('.') && !pattern.includes('*')) {
            return pattern === target;
        }
        // 按段匹配
        for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i] === '*')
                continue;
            if (i >= targetParts.length)
                return false;
            if (patternParts[i] !== targetParts[i])
                return false;
        }
        return patternParts.length >= targetParts.length;
    }
}
//# sourceMappingURL=manager.js.map