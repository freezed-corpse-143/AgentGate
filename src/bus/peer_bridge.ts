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

import * as net from 'net'
import { hostname } from 'os'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createHmac } from 'crypto'
import type { Envelope } from '../types.js'
import type { MessageBus } from './memory_bus.js'
import { RetryQueue } from './retry_queue.js'

// ─── 常量 ──────────────────────────────────────────
const DEFAULT_REGISTRY_PORT = 8444
const HEARTBEAT_INTERVAL = 15_000      // peer 心跳间隔
const HEARTBEAT_TIMEOUT = 60_000       // 心跳超时断开
const PEER_RECONNECT_DELAY = 3_000     // 断线重连延迟
const SEEN_SET_MAX = 5000
const REGISTRY_SECRET = process.env.AGENTGATE_REGISTRY_SECRET

/** HMAC 签名：agent_id + timestamp → hex */
function signRegister(agentId: string, ts: string): string {
  return createHmac('sha256', REGISTRY_SECRET!).update(`${agentId}:${ts}`).digest('hex')
}

/** 验证签名：对比 HMAC，constant-time 防时序攻击 */
function verifySignature(agentId: string, ts: string, signature: string): boolean {
  if (!REGISTRY_SECRET) return true // 未配置密钥时跳过验证
  const expected = signRegister(agentId, ts)
  // 简易 constant-time 比较
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ (signature.charCodeAt(i) || 0)
  }
  return diff === 0
}

// ─── 类型 ──────────────────────────────────────────
export interface PeerInfo {
  agent_id: string; host: string; port: number; seen_at?: string
}

type WireMessage =
  | { type: 'register'; agent_id: string; host: string; port: number; ts: string; signature?: string }
  | { type: 'register_ack'; agent_id: string; peers: PeerInfo[] }
  | { type: 'register_nack'; agent_id: string; reason: string }
  | { type: 'unregister'; agent_id: string }
  | { type: 'peer_join'; agent_id: string; host: string; port: number }
  | { type: 'peer_leave'; agent_id: string }
  | { type: 'message'; topic: string; envelope: Envelope }
  | { type: 'heartbeat' }
  | { type: 'heartbeat_ack' }

// ─── 协议编解码 ──────────────────────────────────
function encode(msg: WireMessage): Buffer {
  return Buffer.from(JSON.stringify(msg) + '\n', 'utf8')
}

function parseLines(buf: Buffer): { msgs: WireMessage[]; rest: Buffer } {
  const msgs: WireMessage[] = []
  let start = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      const line = buf.subarray(start, i).toString('utf8').trim()
      if (line) try { msgs.push(JSON.parse(line)) } catch {}
      start = i + 1
    }
  }
  return { msgs, rest: buf.subarray(start) }
}

// ─── RegistryServer — 注册中心 ────────────────────
export interface RegistryServerOptions {
  port?: number          // 默认 8444
  host?: string          // 默认 '0.0.0.0'
}

/**
 * 注册中心。第一个 MCP Server 启动时自举。
 *
 * - 监听固定端口（默认 8444）
 * - 处理 REGISTER → 返回 peer 列表 + 广播 PEER_JOIN
 * - 处理 UNREGISTER → 广播 PEER_LEAVE
 * - TCP 断开 → 自动广播 PEER_LEAVE
 */
export class RegistryServer {
  private server: net.Server | null = null
  private peers: Map<string, { conn: ClientConn; info: PeerInfo }> = new Map()
  private port: number
  private host: string

  constructor(opts: RegistryServerOptions = {}) {
    this.port = opts.port ?? DEFAULT_REGISTRY_PORT
    this.host = opts.host ?? '0.0.0.0'
  }

  /** 尝试在指定端口启动。失败则抛出异常。 */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((s) => this.onConnect(s))
      this.server.on('error', (e) => reject(e))
      this.server.listen(this.port, this.host, () => resolve())
    })
  }

  stop(): void {
    for (const [, p] of this.peers) p.conn.socket.destroy()
    this.peers.clear()
    this.server?.close()
    this.server = null
  }

  get peerCount(): number { return this.peers.size }
  get peerList(): PeerInfo[] {
    return Array.from(this.peers.values()).map(p => ({
      agent_id: p.info.agent_id, host: p.info.host,
      port: p.info.port, seen_at: new Date().toISOString(),
    }))
  }

  private onConnect(socket: net.Socket): void {
    const buf: Buffer[] = [Buffer.alloc(0)]
    const conn: ClientConn = { socket, agent_id: null, port: 0 }
    let registered = false

    socket.on('data', (chunk) => {
      buf[0] = Buffer.concat([buf[0], chunk])
      const { msgs, rest } = parseLines(buf[0])
      buf[0] = rest
      for (const msg of msgs) this.handleMsg(conn, msg, () => { registered = true })
    })

    socket.on('close', () => {
      if (registered && conn.agent_id) {
        this.peers.delete(conn.agent_id)
        this.broadcast({ type: 'peer_leave', agent_id: conn.agent_id }, null)
      }
    })
    socket.on('error', () => {})
  }

  private handleMsg(conn: ClientConn, msg: WireMessage, onRegistered: () => void): void {
    if (msg.type === 'register') {
      // 签名验证（如果配置了 AGENTGATE_REGISTRY_SECRET）
      if (REGISTRY_SECRET && msg.signature) {
        if (!verifySignature(msg.agent_id, msg.ts, msg.signature)) {
          this.send(conn.socket, { type: 'register_nack', agent_id: msg.agent_id, reason: 'Invalid signature' })
          conn.socket.destroy()
          return
        }
      } else if (REGISTRY_SECRET && !msg.signature) {
        // 需要签名但未提供 → 拒绝
        this.send(conn.socket, { type: 'register_nack', agent_id: msg.agent_id, reason: 'Signature required' })
        conn.socket.destroy()
        return
      }

      conn.agent_id = msg.agent_id
      conn.port = msg.port
      const info: PeerInfo = { agent_id: msg.agent_id, host: msg.host, port: msg.port, seen_at: msg.ts }
      this.peers.set(msg.agent_id, { conn, info })

      // 回复 REGISTER_ACK（含当前所有 peer，排除自身）
      const others = this.peerList.filter(p => p.agent_id !== msg.agent_id)
      this.send(conn.socket, { type: 'register_ack', agent_id: msg.agent_id, peers: others })

      // 广播 PEER_JOIN 给所有已注册的 peer（排除刚注册的这个）
      this.broadcast({ type: 'peer_join', agent_id: msg.agent_id, host: msg.host, port: msg.port }, conn.agent_id)
      onRegistered()
    } else if (msg.type === 'unregister' && conn.agent_id) {
      this.peers.delete(conn.agent_id)
      this.broadcast({ type: 'peer_leave', agent_id: conn.agent_id }, null)
    }
  }

  private send(socket: net.Socket, msg: WireMessage): void {
    try { socket.write(encode(msg)) } catch {}
  }

  private broadcast(msg: WireMessage, excludeAgentId: string | null): void {
    const data = encode(msg)
    for (const [aid, p] of this.peers) {
      if (aid === excludeAgentId) continue
      try { p.conn.socket.write(data) } catch {}
    }
  }
}

// ─── 内部辅助类型 ─────────────────────────────────
interface ClientConn { socket: net.Socket; agent_id: string | null; port: number }

interface PendingPeer {
  agent_id: string; host: string; port: number
  socket: net.Socket | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
}

// ─── BridgeAgent — 每个 MCP Server 的 Bridge 入口 ──
export interface BridgeAgentOptions {
  agentId: string
  bus: MessageBus
  /** 本 agent 监听端口。设为 0 表示 OS 自动分配。默认 0 */
  listenPort?: number
  /** 注册中心地址。默认 127.0.0.1 */
  registryHost?: string
  /** 注册中心端口。默认 8444 */
  registryPort?: number
  /** 向注册中心声明的本机地址。跨机器通信时设为本机的 Tailscale IP 或公网 IP */
  advertiseHost?: string
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
export class BridgeAgent {
  private agentId: string
  private bus: MessageBus
  private listenPort: number
  private registryHost: string
  private registryPort: number

  // 本 agent 的 BridgeServer（接收其他 agent 的连接）
  private server: net.Server | null = null
  private actualPort: number = 0

  // 连接注册中心
  private registrySocket: net.Socket | null = null
  private registryConnected: boolean = false

  // 直连 peers
  private peers: Map<string, PendingPeer> = new Map()
  private seenFromPeers: Set<string> = new Set()

  // 心跳
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  // 是否自举为注册中心
  private isRegistryBootstrap: boolean = false

  // 向注册中心声明的本机地址（默认 127.0.0.1，Tailscale 时设 100.x.x.x）
  private advertiseHost: string

  // 断点重试队列
  private retryQueue: RetryQueue

  constructor(opts: BridgeAgentOptions) {
    this.agentId = opts.agentId
    this.bus = opts.bus
    this.listenPort = opts.listenPort ?? 0
    this.registryHost = opts.registryHost ?? '127.0.0.1'
    this.registryPort = opts.registryPort ?? DEFAULT_REGISTRY_PORT
    this.advertiseHost = opts.advertiseHost || process.env.AGENTGATE_BRIDGE_HOST || '127.0.0.1'

    // 初始化重试队列
    this.retryQueue = new RetryQueue({
      getPeerSocket: (agentId) => {
        const peer = this.peers.get(agentId)
        return peer?.socket ?? null
      },
    })
  }

  get port(): number { return this.actualPort }

  async start(): Promise<void> {
    // 1. 启动自己的 BridgeServer
    await this.startServer()

    // 2. 尝试连接注册中心
    await this.tryConnectRegistry()

    // 3. 启动心跳
    this.heartbeatTimer = setInterval(() => this.sendHeartbeats(), HEARTBEAT_INTERVAL)

    // 4. 启动重试队列
    this.retryQueue.start()

    // 5. 订阅本地 bus 消息，转发给远程 peer
    this.subscribeBus()
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)

    // 停止重试队列
    this.retryQueue.stop()

    // 通知注册中心下线
    if (this.registryConnected) {
      this.sendToRegistry({ type: 'unregister', agent_id: this.agentId })
    }

    // 断开所有 peer 直连
    for (const [, p] of this.peers) {
      if (p.reconnectTimer) clearTimeout(p.reconnectTimer)
      p.socket?.destroy()
    }
    this.peers.clear()

    this.registrySocket?.destroy()
    this.registrySocket = null
    this.server?.close()
    this.server = null
  }

  // ─── BridgeServer：监听入站连接 ────────────────
  private startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleIncoming(socket))
      this.server.on('error', (e) => reject(e))
      this.server.listen(this.listenPort, '127.0.0.1', () => {
        const addr = this.server!.address()
        this.actualPort = typeof addr === 'object' && addr ? addr.port : this.listenPort
        console.error(`[Bridge] Listening on 127.0.0.1:${this.actualPort}`)
        resolve()
      })
    })
  }

  /** 处理其他 agent 的 P2P 直连入站 */
  private handleIncoming(socket: net.Socket): void {
    const buf: Buffer[] = [Buffer.alloc(0)]
    const peerInfo: { agent_id?: string } = {}
    socket.on('data', (chunk) => {
      buf[0] = Buffer.concat([buf[0], chunk])
      const { msgs, rest } = parseLines(buf[0])
      buf[0] = rest
      for (const msg of msgs) {
        if (msg.type === 'register') {
          peerInfo.agent_id = msg.agent_id
          if (!this.peers.has(msg.agent_id)) {
            this.peers.set(msg.agent_id, { agent_id: msg.agent_id, host: msg.host, port: msg.port, socket, reconnectTimer: null })
          }
        } else if (msg.type === 'heartbeat') {
          try { socket.write(encode({ type: 'heartbeat_ack' })) } catch {}
        } else if (msg.type === 'heartbeat_ack') {
          // noop
        } else if (msg.type === 'message' && msg.envelope) {
          this.handlePeerMessage(msg)
        }
      }
    })
    socket.on('close', () => { if (peerInfo.agent_id) this.peers.delete(peerInfo.agent_id) })
    socket.on('error', () => {})
  }

  // ─── 注册中心连接与自举 ────────────────────────
  private async tryConnectRegistry(): Promise<void> {
    // 先尝试连接已有注册中心
    const connected = await this.connectToRegistry()
    if (connected) {
      this.isRegistryBootstrap = false
      console.error(`[Bridge] Connected to registry at ${this.registryHost}:${this.registryPort}`)
      return
    }

    // 连接失败 → 自己自举为注册中心
    const registry = new RegistryServer({ port: this.registryPort, host: '127.0.0.1' })
    try {
      await registry.start()
      this.isRegistryBootstrap = true
      // 自举成功后，把自己注册进去
      console.error(`[Bridge] Self-bootstrapped as registry on :${this.registryPort}`)
      await this.connectToRegistry()
    } catch {
      // 自举也失败（端口已被占用→刚才并发抢占）→ 重试一次连接
      console.error(`[Bridge] Registry bootstrap failed, retrying connection...`)
      await new Promise(r => setTimeout(r, 1000))
      await this.connectToRegistry()
    }
  }

  private connectToRegistry(): Promise<boolean> {
    return new Promise((resolve) => {
      const s = new net.Socket()
      const timer = setTimeout(() => { s.destroy(); resolve(false) }, 2000)

      s.connect(this.registryPort, this.registryHost, () => {
        clearTimeout(timer)
        this.registrySocket = s
        this.registryConnected = true
        this.setupRegistryIO(s)

        // 发送 REGISTER（含签名，如果配置了密钥）
        const regTs = new Date().toISOString()
        const regMsg: WireMessage & { type: 'register' } = {
          type: 'register', agent_id: this.agentId,
          host: this.advertiseHost, port: this.actualPort,
          ts: regTs,
        }
        if (REGISTRY_SECRET) {
          regMsg.signature = signRegister(this.agentId, regTs)
        }
        this.sendToRegistry(regMsg)
        resolve(true)
      })
      s.on('error', () => { clearTimeout(timer); s.destroy(); resolve(false) })
    })
  }

  private setupRegistryIO(s: net.Socket): void {
    const buf: Buffer[] = [Buffer.alloc(0)]
    s.on('data', (chunk) => {
      buf[0] = Buffer.concat([buf[0], chunk])
      const { msgs, rest } = parseLines(buf[0])
      buf[0] = rest
      for (const msg of msgs) this.handleRegistryMsg(msg)
    })
    s.on('close', () => {
      this.registryConnected = false
      this.registrySocket = null
    })
    s.on('error', () => {})
  }

  private sendToRegistry(msg: WireMessage): void {
    try { this.registrySocket?.write(encode(msg)) } catch {}
  }

  // ─── 处理注册中心的消息 ─────────────────────────
  private handleRegistryMsg(msg: WireMessage): void {
    if (msg.type === 'register_ack') {
      // 收到 peer 列表 → 建立直连
      for (const peer of msg.peers) {
        this.connectToPeer(peer)
      }
    } else if (msg.type === 'register_nack') {
      console.error(`[Bridge] Registry rejected registration: ${msg.reason}`)
      this.registrySocket?.destroy()
      this.registrySocket = null
      this.registryConnected = false
    } else if (msg.type === 'peer_join') {
      // 新 agent 上线 → 建立直连
      this.connectToPeer({ agent_id: msg.agent_id, host: msg.host, port: msg.port })
    } else if (msg.type === 'peer_leave') {
      // agent 下线 → 断开直连
      this.disconnectPeer(msg.agent_id)
    }
  }

  // ─── Peer 直连管理 ─────────────────────────────
  private connectToPeer(info: PeerInfo): void {
    if (info.agent_id === this.agentId) return // 不连自己
    if (this.peers.has(info.agent_id)) return   // 已连接

    const peer: PendingPeer = { agent_id: info.agent_id, host: info.host, port: info.port, socket: null, reconnectTimer: null }
    this.peers.set(info.agent_id, peer)
    this.doConnect(peer)
  }

  private doConnect(peer: PendingPeer): void {
    const s = new net.Socket()
    s.connect(peer.port, peer.host, () => {
      peer.socket = s
      // 发送 hello
      s.write(encode({ type: 'register', agent_id: this.agentId, host: this.advertiseHost, port: this.actualPort, ts: new Date().toISOString() }))
      // 清空重试队列中给该 peer 的消息
      this.retryQueue.drain(peer.agent_id)
    })
    const buf: Buffer[] = [Buffer.alloc(0)]
    s.on('data', (chunk) => {
      buf[0] = Buffer.concat([buf[0], chunk])
      const { msgs, rest } = parseLines(buf[0])
      buf[0] = rest
      for (const msg of msgs) {
        if (msg.type === 'heartbeat') { try { s.write(encode({ type: 'heartbeat_ack' })) } catch {} }
        else if (msg.type === 'heartbeat_ack') { /* do nothing */ }
        else if (msg.type === 'message' && msg.envelope) { this.handlePeerMessage(msg) }
      }
    })
    s.on('close', () => {
      peer.socket = null
      // 自动重连
      if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer)
      peer.reconnectTimer = setTimeout(() => this.doConnect(peer), PEER_RECONNECT_DELAY)
    })
    s.on('error', () => {})
  }

  private disconnectPeer(agentId: string): void {
    const peer = this.peers.get(agentId)
    if (!peer) return
    if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer)
    peer.socket?.destroy()
    this.peers.delete(agentId)
  }

  // ─── 消息路由 ──────────────────────────────────
  private handlePeerMessage(msg: { type: 'message'; topic: string; envelope: Envelope }): void {
    if (msg.envelope.message_id && this.seenFromPeers.has(msg.envelope.message_id)) return
    if (msg.envelope.message_id) {
      this.seenFromPeers.add(msg.envelope.message_id)
      if (this.seenFromPeers.size > SEEN_SET_MAX) this.seenFromPeers.clear()
    }
    this.bus.publish(msg.topic, msg.envelope)
  }

  /** 订阅本地 bus，将需要远程投递的消息转发给对应 peer */
  private subscribeBus(): void {
    this.bus.subscribeWildcard('agent.*.inbound', (envelope: Envelope) => {
      this.routeToPeer(envelope.agent_id, envelope)
    })
    this.bus.subscribeWildcard('agent.*.outbound', (envelope: Envelope) => {
      this.routeToPeer(envelope.agent_id, envelope)
    })
    this.bus.subscribeWildcard('_system.*', (envelope: Envelope, topic: string) => {
      this.broadcastToPeers(topic, envelope)
    })
  }

  private routeToPeer(targetAgentId: string, envelope: Envelope): void {
    if (targetAgentId === this.agentId) return // 本地消息，已通过 bus 直接处理
    const peer = this.peers.get(targetAgentId)
    const topic = `agent.${targetAgentId}.inbound`
    if (!peer || !peer.socket) {
      this.retryQueue.enqueue(envelope, targetAgentId, topic)
      return
    }
    try {
      peer.socket.write(encode({ type: 'message', topic, envelope }))
    } catch {
      this.retryQueue.enqueue(envelope, targetAgentId, topic)
    }
  }

  private broadcastToPeers(topic: string, envelope: Envelope): void {
    const data = encode({ type: 'message', topic, envelope })
    for (const [aid, p] of this.peers) {
      if (!p.socket) {
        this.retryQueue.enqueue(envelope, aid, topic)
        continue
      }
      try { p.socket.write(data) } catch {
        this.retryQueue.enqueue(envelope, aid, topic)
      }
    }
  }

  // ─── 心跳 ──────────────────────────────────────
  private sendHeartbeats(): void {
    const now = Date.now()
    for (const [aid, p] of this.peers) {
      if (!p.socket) continue
      try { p.socket.write(encode({ type: 'heartbeat' })) } catch {}
    }
  }
}
