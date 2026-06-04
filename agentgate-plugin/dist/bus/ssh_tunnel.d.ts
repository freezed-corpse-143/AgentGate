/**
 * AgentGate — SSH 隧道管理器
 *
 * 利用 ssh2 库建立 SSH Remote Port Forwarding，将本机 Bridge 端口
 * 暴露到跳板机(Jumphost)，实现跨主机组网。
 *
 * 等价于命令行: ssh -R <remotePort>:localhost:<localPort> user@jumphost -N
 *
 * 核心能力:
 * - Remote Port Forwarding (ssh -R)：跳板机监听 remotePort → 转发到本机 localPort
 * - Local Port Forwarding (ssh -L)：本机监听 localPort → 转发到远程 remoteHost:remotePort
 * - 断线自动重连（指数退避）
 * - SSH keepalive 保活
 * - 干净的生命周期管理
 */
import { Client as SshClient } from 'ssh2';
export interface SshTunnelOptions {
    /** SSH 跳板机地址 (user@host:port / host:port / host) */
    jumphost: string;
    /** SSH 用户名（省略时从 jumphost 解析） */
    username?: string;
    /** SSH 端口（默认 22，省略时从 jumphost 解析） */
    port?: number;
    /** SSH 私钥路径（默认 ~/.ssh/id_rsa） */
    keyPath?: string;
    /** 私钥内容（优先于 keyPath） */
    privateKey?: string | Buffer;
    /** 密码认证（不推荐，优先使用密钥） */
    password?: string;
    /** 本机要暴露的端口 */
    localPort: number;
    /** 远程（跳板机上的）端口 */
    remotePort: number;
    /** 远程绑定地址（默认 '0.0.0.0'） */
    remoteBindAddr?: string;
    /** 额外本地端口转发: [{ localPort, remoteHost, remotePort }] */
    localForwards?: Array<{
        localPort: number;
        remoteHost: string;
        remotePort: number;
    }>;
    /** SSH keepalive 间隔 (ms, 默认 15000) */
    keepaliveInterval?: number;
    /** 最大 keepalive 失败次数（默认 3） */
    keepaliveCountMax?: number;
    /** 是否启用 */
    enabled?: boolean;
}
export type SshTunnelStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export interface SshTunnelEvents {
    onConnected?: () => void;
    onDisconnected?: (err?: Error) => void;
    onError?: (err: Error) => void;
    onReconnecting?: (attempt: number, delay: number) => void;
}
/**
 * SSH 隧道管理器。
 *
 * 用法:
 * ```ts
 * const tunnel = new SshTunnelManager({
 *   jumphost: 'user@jumphost.example.com:22',
 *   localPort: 18445,
 *   remotePort: 18445,
 *   keyPath: '/home/user/.ssh/id_rsa',
 * })
 * await tunnel.start()
 * // ... 运行中 ...
 * await tunnel.stop()
 * ```
 */
export declare class SshTunnelManager {
    private client;
    private opts;
    private events?;
    private _status;
    private reconnectAttempt;
    private reconnectTimer;
    private stopped;
    private localServers;
    private activeForwards;
    constructor(opts: SshTunnelOptions, events?: SshTunnelEvents);
    /** 当前隧道状态 */
    get status(): SshTunnelStatus;
    /** 底层 SSH 客户端（供外部主动操作） */
    get sshClient(): SshClient | null;
    /** 启动隧道 */
    start(): Promise<void>;
    /** 停止隧道 */
    stop(): Promise<void>;
    /** 重启隧道 */
    restart(): Promise<void>;
    private connect;
    /** 建立 Remote Port Forwarding (ssh -R) */
    private setupRemoteForwards;
    /** 建立 Local Port Forwarding (ssh -L) */
    private setupLocalForwards;
    private createLocalForward;
    /** 断线重连（指数退避） */
    private scheduleReconnect;
    /**
     * 解析 jumphost 字符串。
     *
     * 支持格式:
     *   - user@host:port
     *   - user@host
     *   - host:port
     *   - host
     */
    private parseJumphost;
    /** 合并默认配置（环境变量覆盖） */
    private resolveOptions;
}
//# sourceMappingURL=ssh_tunnel.d.ts.map