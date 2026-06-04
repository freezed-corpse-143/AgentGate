/**
 * AgentGate — 内存消息总线
 *
 * 基于 EventEmitter 的发布/订阅消息总线，解耦信道适配器和 Agent Runtime。
 * 所有 Envelope 通过 Bus 投递，信道适配器和 Agent 都不直接互相引用。
 *
 * 参考 guide.md §6: Mailbox + Topic Bus 模式。
 * Topic 命名: agent.{agent_id}.inbound  /  agent.{agent_id}.outbound
 */
import { EventEmitter } from 'events';
export class MemoryBus {
    emitter = new EventEmitter();
    maxListeners;
    /** 跟踪 handler → wrapper 的映射，支持 unsubscribe */
    handlerMap = new Map();
    constructor(maxListeners = 50) {
        this.maxListeners = maxListeners;
        this.emitter.setMaxListeners(maxListeners);
    }
    publish(topic, envelope) {
        const event = {
            topic,
            envelope,
            published_at: Date.now(),
        };
        this.emitter.emit(topic, event);
        // 也触发通配符匹配
        this.emitter.emit('*', event);
    }
    subscribe(topic, handler) {
        const wrapper = (event) => {
            handler(event.envelope, event.topic);
        };
        // 保存映射用于 unsubscribe
        if (!this.handlerMap.has(topic)) {
            this.handlerMap.set(topic, new Map());
        }
        this.handlerMap.get(topic).set(handler, wrapper);
        this.emitter.on(topic, wrapper);
    }
    unsubscribe(topic, handler) {
        const handlers = this.handlerMap.get(topic);
        if (!handlers)
            return;
        const wrapper = handlers.get(handler);
        if (wrapper) {
            this.emitter.off(topic, wrapper);
            handlers.delete(handler);
        }
    }
    subscribeWildcard(pattern, handler) {
        // 通配符订阅: 监听所有消息，按 pattern 过滤
        this.emitter.on('*', (event) => {
            if (this.matchWildcard(pattern, event.topic)) {
                handler(event.envelope, event.topic);
            }
        });
    }
    /** 通配符匹配: agent.*.inbound → agent.abc.inbound 匹配 */
    matchWildcard(pattern, topic) {
        const patternParts = pattern.split('.');
        const topicParts = topic.split('.');
        if (patternParts.length !== topicParts.length)
            return false;
        for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i] === '*')
                continue;
            if (patternParts[i] !== topicParts[i])
                return false;
        }
        return true;
    }
    /** 清除所有订阅 (用于测试/关闭) */
    clear() {
        this.emitter.removeAllListeners();
    }
}
//# sourceMappingURL=memory_bus.js.map