export class OutboundDispatcher {
    adapters = new Map();
    constructor(adapters) {
        for (const adapter of adapters) {
            this.adapters.set(adapter.channelType, adapter);
        }
    }
    /** 注册到 Message Bus */
    attach(bus) {
        bus.subscribeWildcard('agent.*.outbound', async (envelope, topic) => {
            await this.dispatch(envelope);
        });
        console.error('[Dispatcher] Attached to bus — listening on agent.*.outbound');
    }
    /** 分发一条出站 Envelope */
    async dispatch(envelope) {
        const adapter = this.adapters.get(envelope.channel);
        if (!adapter) {
            console.warn(`[Dispatcher] No adapter for channel: ${envelope.channel}`);
            return;
        }
        try {
            await adapter.send(envelope);
            console.error(`[Dispatcher] Dispatched ${envelope.message_id} → ${envelope.channel}`);
        }
        catch (err) {
            console.error(`[Dispatcher] Failed to dispatch ${envelope.message_id}: ${err}`);
        }
    }
    /** 运行时注册新适配器 */
    register(adapter) {
        this.adapters.set(adapter.channelType, adapter);
    }
}
//# sourceMappingURL=outbound_dispatcher.js.map