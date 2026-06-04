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
import * as net from 'net';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
// ─── 常量 ──────────────────────────────────────────
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const BACKOFF_FACTOR = 2;
// ─── SshTunnelManager ──────────────────────────────
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
export class SshTunnelManager {
    client = null;
    opts;
    events;
    _status = 'disconnected';
    reconnectAttempt = 0;
    reconnectTimer = null;
    stopped = false;
    localServers = [];
    activeForwards = [];
    constructor(opts, events) {
        this.opts = this.resolveOptions(opts);
        this.events = events;
    }
    /** 当前隧道状态 */
    get status() {
        return this._status;
    }
    /** 底层 SSH 客户端（供外部主动操作） */
    get sshClient() {
        return this.client;
    }
    /** 启动隧道 */
    async start() {
        if (!this.opts.enabled)
            return;
        this.stopped = false;
        this.connect();
    }
    /** 停止隧道 */
    async stop() {
        this.stopped = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        // 关闭本地转发服务
        for (const srv of this.localServers) {
            try {
                srv.close();
            }
            catch { }
        }
        this.localServers = [];
        this.activeForwards = [];
        if (this.client) {
            try {
                this.client.end();
            }
            catch { }
            this.client = null;
        }
        this._status = 'disconnected';
    }
    /** 重启隧道 */
    async restart() {
        await this.stop();
        this.reconnectAttempt = 0;
        await this.start();
    }
    // ─── 内部连接管理 ──────────────────────────────
    connect() {
        if (this.stopped)
            return;
        this._status = 'connecting';
        this.client = new SshClient();
        const { host, port, username } = this.parseJumphost(this.opts.jumphost);
        const connectConfig = {
            host,
            port: this.opts.port ?? port,
            username: this.opts.username ?? username,
            keepaliveInterval: this.opts.keepaliveInterval ?? 15_000,
            keepaliveCountMax: this.opts.keepaliveCountMax ?? 3,
            readyTimeout: 10_000,
        };
        // 优先使用私钥内容，其次私钥文件，最后密码
        if (this.opts.privateKey) {
            connectConfig.privateKey = this.opts.privateKey;
        }
        else if (this.opts.keyPath) {
            try {
                if (existsSync(this.opts.keyPath)) {
                    connectConfig.privateKey = readFileSync(this.opts.keyPath, 'utf8');
                }
            }
            catch (err) {
                console.error(`[SshTunnel] Failed to read key ${this.opts.keyPath}: ${err}`);
            }
        }
        if (this.opts.password) {
            connectConfig.password = this.opts.password;
        }
        // ── 事件绑定 ──────────────────────────────────
        this.client.on('ready', () => {
            console.error(`[SshTunnel] Connected to ${this.opts.jumphost}`);
            this._status = 'connected';
            this.reconnectAttempt = 0;
            this.events?.onConnected?.();
            // 建立 Remote Port Forwarding (ssh -R)
            this.setupRemoteForwards();
            // 建立 Local Port Forwarding (ssh -L)
            this.setupLocalForwards();
        });
        this.client.on('error', (err) => {
            console.error(`[SshTunnel] Error: ${err.message}`);
            this._status = 'error';
            this.events?.onError?.(err);
        });
        this.client.on('close', () => {
            // 注意：ssh2 运行时 close 事件会带 hadError 参数，
            // 但类型定义签名中没有。用 _status 判断是否有错误。
            const wasError = this._status === 'error';
            console.error(`[SshTunnel] Disconnected (wasError=${wasError})`);
            this._status = 'disconnected';
            this.events?.onDisconnected?.(wasError ? new Error('SSH connection closed with error') : undefined);
            this.scheduleReconnect();
        });
        this.client.on('end', () => {
            console.error('[SshTunnel] Connection ended');
        });
        // ── 处理入站转发连接 ──────────────────────────
        // 当远程主机（跳板机）上有人连接到转发的端口时，
        // SSH server 会通过隧道把连接送回，触发此事件
        this.client.on('tcp connection', (details, accept, reject) => {
            const forwardCfg = this.activeForwards.find((f) => f.remotePort === details.destPort);
            if (!forwardCfg) {
                reject();
                return;
            }
            const remoteStream = accept();
            const local = net.connect(forwardCfg.localPort, '127.0.0.1', () => {
                remoteStream.pipe(local).pipe(remoteStream);
            });
            local.on('error', () => {
                try {
                    remoteStream.close();
                }
                catch { }
            });
            remoteStream.on('error', () => {
                try {
                    local.destroy();
                }
                catch { }
            });
        });
        try {
            this.client.connect(connectConfig);
        }
        catch (err) {
            console.error(`[SshTunnel] Connect failed: ${err}`);
            this._status = 'error';
            this.scheduleReconnect();
        }
    }
    /** 建立 Remote Port Forwarding (ssh -R) */
    setupRemoteForwards() {
        if (!this.client)
            return;
        const { remotePort, localPort, remoteBindAddr } = this.opts;
        const cfg = {
            remoteAddr: remoteBindAddr ?? '0.0.0.0',
            remotePort,
            localPort,
        };
        this.client.forwardIn(cfg.remoteAddr, cfg.remotePort, (err) => {
            if (err) {
                console.error(`[SshTunnel] forwardIn(${cfg.remoteAddr}:${remotePort} → localhost:${localPort}) failed: ${err.message}`);
                this.events?.onError?.(err);
                return;
            }
            console.error(`[SshTunnel] Remote forward active: ${cfg.remoteAddr}:${remotePort} → localhost:${localPort}`);
            this.activeForwards.push(cfg);
        });
    }
    /** 建立 Local Port Forwarding (ssh -L) */
    setupLocalForwards() {
        if (!this.opts.localForwards)
            return;
        for (const fwd of this.opts.localForwards) {
            this.createLocalForward(fwd.localPort, fwd.remoteHost, fwd.remotePort);
        }
    }
    createLocalForward(localPort, remoteHost, remotePort) {
        const server = net.createServer((localSocket) => {
            if (!this.client) {
                localSocket.destroy();
                return;
            }
            this.client.forwardOut('127.0.0.1', localPort, remoteHost, remotePort, (err, remoteStream) => {
                if (err || !remoteStream) {
                    localSocket.destroy();
                    return;
                }
                localSocket.pipe(remoteStream).pipe(localSocket);
            });
        });
        server.listen(localPort, '127.0.0.1', () => {
            console.error(`[SshTunnel] Local forward active: :${localPort} → ${remoteHost}:${remotePort}`);
        });
        server.on('error', (err) => {
            console.error(`[SshTunnel] Local forward error (:${localPort}): ${err.message}`);
        });
        this.localServers.push(server);
    }
    /** 断线重连（指数退避） */
    scheduleReconnect() {
        if (this.stopped)
            return;
        const delay = Math.min(DEFAULT_RECONNECT_DELAY_MS * Math.pow(BACKOFF_FACTOR, this.reconnectAttempt), MAX_RECONNECT_DELAY_MS);
        this.reconnectAttempt++;
        this.events?.onReconnecting?.(this.reconnectAttempt, delay);
        console.error(`[SshTunnel] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
        this.reconnectTimer = setTimeout(() => {
            if (!this.stopped)
                this.connect();
        }, delay);
    }
    // ─── 辅助方法 ──────────────────────────────────
    /**
     * 解析 jumphost 字符串。
     *
     * 支持格式:
     *   - user@host:port
     *   - user@host
     *   - host:port
     *   - host
     */
    parseJumphost(jumphost) {
        let host = jumphost;
        let port = 22;
        let username;
        // 提取 user@
        const atIdx = host.lastIndexOf('@');
        if (atIdx >= 0) {
            username = host.slice(0, atIdx);
            host = host.slice(atIdx + 1);
        }
        // 提取 :port
        const colonIdx = host.lastIndexOf(':');
        if (colonIdx >= 0) {
            port = parseInt(host.slice(colonIdx + 1), 10) || 22;
            host = host.slice(0, colonIdx);
        }
        return { host, port, username };
    }
    /** 合并默认配置（环境变量覆盖） */
    resolveOptions(opts) {
        const envJumphost = process.env.AGENTGATE_SSH_JUMPHOST;
        const envKeyPath = process.env.AGENTGATE_SSH_KEY;
        const envUser = process.env.AGENTGATE_SSH_USER;
        return {
            ...opts,
            jumphost: opts.jumphost || envJumphost || '',
            username: opts.username || envUser || undefined,
            keyPath: opts.keyPath || envKeyPath || join(homedir(), '.ssh', 'id_rsa'),
            enabled: opts.enabled ?? (process.env.AGENTGATE_SSH_ENABLED === 'true' || process.env.AGENTGATE_SSH_ENABLED === '1'),
            remoteBindAddr: opts.remoteBindAddr ?? '0.0.0.0',
            keepaliveInterval: opts.keepaliveInterval ?? 15_000,
            keepaliveCountMax: opts.keepaliveCountMax ?? 3,
        };
    }
}
//# sourceMappingURL=ssh_tunnel.js.map