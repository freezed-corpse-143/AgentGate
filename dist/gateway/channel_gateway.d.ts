/**
 * AgentGate — Channel Gateway
 *
 * 信道无关的网关逻辑：接收原始消息 → 查绑定 → 校验权限 → 生成 Envelope → 投递到 Message Bus。
 *
 * 这是 guide.md 架构中的关键枢纽层：
 *   Channel Adapter → Gateway → Envelope → Auth → Session Router → Message Bus → Agent Runtime
 *
 * 参考 Telegram 插件的 gate() 函数 (server.ts:138-192)：
 *  - gate() 负责判断消息是否应该被交付、丢弃或触发配对
 *  - ChannelGateway 实现了相同的三层决策：查找绑定 / 校验权限 / 生成 Envelope
 */
import type { RawMessage, Envelope } from '../types.js';
import type { MessageBus } from '../bus/memory_bus.js';
import type { HandshakeManager } from '../auth/handshake.js';
import type { BindingStore } from '../auth/binding_store.js';
export type GateAction = {
    action: 'deliver';
    envelope: Envelope;
} | {
    action: 'drop';
    reason: string;
} | {
    action: 'pair';
    code: string;
};
export interface GatewayDeps {
    bindingStore: BindingStore;
    handshake: HandshakeManager;
    bus: MessageBus;
    defaultAgentId: string;
}
/**
 * Channel Gateway — 消息出入的统一关口。
 *
 * 职责：
 * 1. receive(raw): 接收原始消息 → 查绑定 → 校验 → 生成 Envelope → 投递到 Bus
 * 2. 无绑定时触发配对流程
 * 3. 绑定被撤销时丢弃消息
 */
export declare class ChannelGateway {
    private deps;
    constructor(deps: GatewayDeps);
    /**
     * 接收一条原始消息，执行完整的网关决策流程。
     *
     * 决策树 (参考 Telegram 插件 gate()):
     *   1. bindingStore.getBinding(channel, userId)
     *      ├── 无绑定 → handshake.requestPairing()
     *      │            ├── 配对码已存在 (未过期) → 返回 pair (不重复生成)
     *      │            └── 新配对码 → 返回 pair
     *      └── 有绑定
     *           ├── status !== 'active' → drop
     *           └── status === 'active'
     *                ├── 校验权限 → 失败 → drop
     *                └── 通过 → createEnvelope() → bus.publish() → deliver
     */
    receive(raw: RawMessage): Promise<GateAction>;
    /**
     * 将出站 Envelope 分发回信道。
     * 由 OutboundDispatcher 调用。
     */
    dispatchOutbound(envelope: Envelope): Promise<void>;
}
//# sourceMappingURL=channel_gateway.d.ts.map