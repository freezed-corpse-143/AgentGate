/**
 * AgentGate — 订阅管理器
 *
 * 允许外部用户订阅 topic 模式，当匹配的 Envelope 经过 Bus 时
 * 自动推送给订阅者（通过指定信道发送通知）。
 *
 * 使用场景:
 *   - 用户订阅 "agent.*.inbound" → 所有 agent 入站消息推送给用户
 *   - 用户订阅 "agent.agent-alpha.outbound" → 特定 agent 回复推送给用户
 *   - 系统订阅 "_broadcast" → 所有广播通知推送给管理信道
 */
import type { MessageBus } from '../bus/memory_bus.js';
import type { ChannelAdapter } from '../channels/base.js';
export interface Subscription {
    id: string;
    /** 订阅者标识（如 telegram 的 chat_id） */
    subscriberId: string;
    /** 推送目标信道类型 */
    channel: string;
    /** topic 模式（glob，支持 * 通配符） */
    topicPattern: string;
    /** 可选过滤条件 */
    label?: string;
    createdAt: string;
}
export interface SubscriptionManagerOptions {
    bus: MessageBus;
    /** 获取适配器列表的回调（用于推送通知） */
    getAdapters: () => ChannelAdapter[];
}
export declare class SubscriptionManager {
    private bus;
    private getAdapters;
    private subscriptions;
    private running;
    private nextId;
    constructor(opts: SubscriptionManagerOptions);
    /** 启动：订阅所有 topic 进行匹配 */
    start(): void;
    /** 停止 */
    stop(): void;
    /** 创建订阅 */
    subscribe(subscriberId: string, channel: string, topicPattern: string, label?: string): Subscription;
    /** 取消订阅 */
    unsubscribe(subscriptionId: string): boolean;
    /** 列出某用户的所有订阅 */
    listBySubscriber(subscriberId: string): Subscription[];
    /** 列出所有订阅 */
    listAll(): Subscription[];
    /** 按 ID 查找 */
    get(id: string): Subscription | undefined;
    /** 当前订阅总数 */
    get count(): number;
    /** 匹配所有订阅，推送匹配的 Envelope */
    private matchAndDeliver;
    /** topic 通配符匹配 */
    private matchTopic;
    /** 简单的 glob 匹配（只支持 *） */
    private globMatch;
}
//# sourceMappingURL=manager.d.ts.map