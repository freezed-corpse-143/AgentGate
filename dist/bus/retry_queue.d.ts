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
import type { Envelope } from '../types.js';
export type PeerSocketGetter = (agentId: string) => {
    write(data: Buffer): boolean;
} | null;
export interface RetryQueueOptions {
    /** 获取 peer socket 的回调，由 BridgeAgent 提供 */
    getPeerSocket: PeerSocketGetter;
    /** 消息序列化回调（默认 JSON.stringify + \n） */
    encode?: (envelope: Envelope, topic: string) => Buffer;
}
export declare class RetryQueue {
    private queue;
    private getPeerSocket;
    private encode;
    private drainTimer;
    private running;
    onDeadLetter: ((envelope: Envelope, targetAgentId: string, reason: string) => void) | null;
    constructor(opts: RetryQueueOptions);
    /** 启动重试定时器 */
    start(): void;
    /** 停止重试定时器 */
    stop(): void;
    /** 入队一条发送失败的消息 */
    enqueue(envelope: Envelope, targetAgentId: string, topic: string): void;
    /** peer 重连时立即清空其队列 */
    drain(targetAgentId: string): number;
    /** 当前待重试消息数 */
    get pendingCount(): number;
    /** 默认序列化：JSON line */
    private defaultEncode;
    /** 定时器触发：检查所有队列中到期的消息 */
    private tick;
    /** 指数退避计算 */
    private backoff;
}
//# sourceMappingURL=retry_queue.d.ts.map