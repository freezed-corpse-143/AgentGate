import type { ChannelAdapter, MessageCallback } from './base.js';
import type { ChannelType, Envelope } from '../types.js';
export interface TelegramAdapterOptions {
    token: string;
    /** 自定义 Bot API 根 (用于 Mock 测试) */
    apiRoot?: string;
    /** 允许的用户 ID 列表 (简化版 access control) */
    allowFrom?: string[];
    /** 轮询超时秒数（测试时设短值，默认 10） */
    pollingTimeout?: number;
}
export declare class TelegramAdapter implements ChannelAdapter {
    readonly channelType: ChannelType;
    private bot;
    private callback;
    private running;
    private allowFrom;
    private options;
    private botUsername;
    constructor(options: TelegramAdapterOptions);
    /** PID 文件防多实例冲突 (参考 Telegram 插件 server.ts:59-70) */
    private claimPid;
    private releasePid;
    /** 注册 grammy 消息处理器 */
    private setupBot;
    /** 检查是否被 @mention (参考 Telegram 插件 isMentioned) */
    private isMentioned;
    /** 出站消息: 通过 Telegram sendMessage 发送 */
    send(envelope: Envelope): Promise<void>;
    /** 注册入站消息回调 */
    onMessage(callback: MessageCallback): void;
    /** 启动轮询 */
    start(): Promise<void>;
    /** 停止轮询 */
    stop(): Promise<void>;
}
//# sourceMappingURL=telegram_adapter.d.ts.map