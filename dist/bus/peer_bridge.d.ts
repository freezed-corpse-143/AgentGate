/**
 * Bridge v2 — 去中心化注册 + P2P 直连
 *
 * 架构详见 docs/BRIDGE_PROTOCOL.md
 *
 * 核心组件：
 *   RegistryServer  — 固定端口 (:8444)，管理 agent 注册，广播上下线
 *   RegistryClient  — 连接注册中心，维护 peer 表
 *   PeerManager     — 管理直连 TCP，按 topic 路由消息
 */
import type { MessageBus } from './memory_bus.js';
export interface PeerInfo {
    agent_id: string;
    host: string;
    port: number;
    seen_at?: string;
}
export interface RegistryServerOptions {
    port?: number;
    host?: string;
}
/**
 * 注册中心。第一个 MCP Server 启动时自举。
 *
 * - 监听固定端口（默认 8444）
 * - 处理 REGISTER → 返回 peer 列表 + 广播 PEER_JOIN
 * - 处理 UNREGISTER → 广播 PEER_LEAVE
 * - TCP 断开 → 自动广播 PEER_LEAVE
 */
export declare class RegistryServer {
    private server;
    private peers;
    private port;
    private host;
    constructor(opts?: RegistryServerOptions);
    /** 尝试在指定端口启动。失败则抛出异常。 */
    start(): Promise<void>;
    stop(): void;
    get peerCount(): number;
    get peerList(): PeerInfo[];
    private onConnect;
    private handleMsg;
    private send;
    private broadcast;
}
export interface BridgeAgentOptions {
    agentId: string;
    bus: MessageBus;
    /** 本 agent 监听端口。设为 0 表示 OS 自动分配。默认 0 */
    listenPort?: number;
    /** 注册中心地址。默认 127.0.0.1 */
    registryHost?: string;
    /** 注册中心端口。默认 8444 */
    registryPort?: number;
    /** 向注册中心声明的本机地址。跨机器通信时设为本机的 Tailscale IP 或公网 IP */
    advertiseHost?: string;
}
/**
 * BridgeAgent 封装了完整的注册+通信生命周期。
 *
 * 使用方式：
 *   const bridge = new BridgeAgent({ agentId, bus })
 *   await bridge.start()
 *   // ... 运行中 ...
 *   bridge.stop()
 */
export declare class BridgeAgent {
    private agentId;
    private bus;
    private listenPort;
    private registryHost;
    private registryPort;
    private server;
    private actualPort;
    private registrySocket;
    private registryConnected;
    private peers;
    private seenFromPeers;
    private heartbeatTimer;
    private isRegistryBootstrap;
    private advertiseHost;
    private retryQueue;
    constructor(opts: BridgeAgentOptions);
    get port(): number;
    start(): Promise<void>;
    stop(): void;
    private startServer;
    /** 处理其他 agent 的 P2P 直连入站 */
    private handleIncoming;
    private tryConnectRegistry;
    private connectToRegistry;
    private setupRegistryIO;
    private sendToRegistry;
    private handleRegistryMsg;
    private connectToPeer;
    private doConnect;
    private disconnectPeer;
    private handlePeerMessage;
    /** 订阅本地 bus，将需要远程投递的消息转发给对应 peer */
    private subscribeBus;
    private routeToPeer;
    private broadcastToPeers;
    private sendHeartbeats;
}
//# sourceMappingURL=peer_bridge.d.ts.map