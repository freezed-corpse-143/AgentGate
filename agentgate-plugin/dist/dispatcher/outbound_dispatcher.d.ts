/**
 * AgentGate — Outbound Dispatcher
 *
 * 将 Agent 的出站回复通过正确的信道适配器发送出去。
 * 订阅 agent.*.outbound topic，按 envelope.channel 找到对应的
 * ChannelAdapter 并调用 send()。
 */
import type { Envelope } from '../types.js';
import type { MessageBus } from '../bus/memory_bus.js';
import type { ChannelAdapter } from '../channels/base.js';
export declare class OutboundDispatcher {
    private adapters;
    constructor(adapters: ChannelAdapter[]);
    /** 注册到 Message Bus */
    attach(bus: MessageBus): void;
    /** 分发一条出站 Envelope */
    dispatch(envelope: Envelope): Promise<void>;
    /** 运行时注册新适配器 */
    register(adapter: ChannelAdapter): void;
}
//# sourceMappingURL=outbound_dispatcher.d.ts.map