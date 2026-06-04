const BROADCAST_TOPIC = '_broadcast';
const MAX_SEEN_IDS = 10_000;
export class BroadcastAdapter {
    channelType = 'broadcast';
    bus;
    callback = null;
    running = false;
    seenIds = new Set();
    constructor(bus) {
        this.bus = bus;
    }
    async start() {
        if (this.running)
            return;
        this.running = true;
        // 订阅广播 topic：收到广播消息 → 转给 gateway
        this.bus.subscribeWildcard(BROADCAST_TOPIC, (envelope) => {
            if (!this.callback || !this.running)
                return;
            const msgId = envelope.message_id;
            if (!msgId)
                return;
            if (this.seenIds.has(msgId))
                return;
            this.seenIds.add(msgId);
            if (this.seenIds.size > MAX_SEEN_IDS)
                this.seenIds.clear();
            this.callback({
                channel: 'broadcast',
                channel_user_id: envelope.channel_user_id || '_broadcast',
                chat_id: `broadcast:${envelope.channel_user_id || '_system'}`,
                text: envelope.payload.text ?? '',
                message_id: msgId,
            });
        });
        console.error('[Broadcast] Listening on _broadcast');
    }
    async stop() {
        this.running = false;
    }
    async send(envelope) {
        if (!this.running)
            return;
        // 发布到广播 topic
        this.bus.publish(BROADCAST_TOPIC, envelope);
    }
    onMessage(callback) {
        this.callback = callback;
    }
}
//# sourceMappingURL=broadcast_adapter.js.map