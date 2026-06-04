import type { Envelope } from '../types.js';
export interface MessageBus {
    /** 发布消息到指定 topic */
    publish(topic: string, envelope: Envelope): void;
    /** 订阅 topic */
    subscribe(topic: string, handler: MessageHandler): void;
    /** 取消订阅 */
    unsubscribe(topic: string, handler: MessageHandler): void;
    /** 通配符订阅: agent.*.inbound 匹配所有入站 */
    subscribeWildcard(pattern: string, handler: MessageHandler): void;
}
export type MessageHandler = (envelope: Envelope, topic: string) => void;
export declare class MemoryBus implements MessageBus {
    private emitter;
    private maxListeners;
    /** 跟踪 handler → wrapper 的映射，支持 unsubscribe */
    private handlerMap;
    constructor(maxListeners?: number);
    publish(topic: string, envelope: Envelope): void;
    subscribe(topic: string, handler: MessageHandler): void;
    unsubscribe(topic: string, handler: MessageHandler): void;
    subscribeWildcard(pattern: string, handler: MessageHandler): void;
    /** 通配符匹配: agent.*.inbound → agent.abc.inbound 匹配 */
    private matchWildcard;
    /** 清除所有订阅 (用于测试/关闭) */
    clear(): void;
}
//# sourceMappingURL=memory_bus.d.ts.map