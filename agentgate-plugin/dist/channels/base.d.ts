/**
 * AgentGate — 信道适配器接口
 *
 * 定义所有信道适配器必须实现的接口。
 * 新的信道类型只需实现 ChannelAdapter，注册到系统即可使用。
 *
 * 参考 guide.md §1 架构图:
 *   Channel Adapter → Channel Gateway → Message Bus → Agent Runtime
 */
import type { ChannelType, RawMessage, Envelope } from '../types.js';
export type MessageCallback = (raw: RawMessage) => void;
export interface ChannelAdapter {
    /** 信道类型标识 */
    readonly channelType: ChannelType;
    /** 启动适配器 (开始轮询 / 监听端口) */
    start(): Promise<void>;
    /** 停止适配器 */
    stop(): Promise<void>;
    /** 通过本信道发送出站消息 */
    send(envelope: Envelope): Promise<void>;
    /** 注册入站消息回调 (由 ChannelGateway.receive 处理) */
    onMessage(callback: MessageCallback): void;
}
//# sourceMappingURL=base.d.ts.map