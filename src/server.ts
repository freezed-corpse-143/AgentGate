/**
 * AgentGate — Server 启动函数
 */
import { MemoryBus } from './bus/memory_bus.js'
import { BindingStore } from './auth/binding_store.js'
import { HandshakeManager } from './auth/handshake.js'
import { ChannelGateway } from './gateway/channel_gateway.js'
import { AgentRegistry } from './agents/registry.js'
import { AgentRuntime } from './agents/runtime.js'
import { SessionRegistry } from './sessions/session_registry.js'
import { SessionRouter } from './sessions/router.js'
import { OutboundDispatcher } from './bus/outbound_dispatcher.js'
import { RESTAdapter } from './channels/rest_adapter.js'
import { TelegramAdapter } from './channels/telegram_adapter.js'
import { SSHAdapter } from './channels/ssh_adapter.js'
import { ConversationStore } from './storage/conversation_store.js'
import { ConversationSync } from './storage/conversation_sync.js'
import { BridgeAgent } from './bus/peer_bridge.js'
import type { AgentGateConfig } from './config.js'
import type { AgentSpec, RawMessage } from './types.js'
import type { ChannelAdapter } from './channels/base.js'

export interface ServerOptions {
  headless?: boolean
}

export interface AgentGateServer {
  bus: MemoryBus
  agentRegistry: AgentRegistry
  runtime: AgentRuntime
  adapters: ChannelAdapter[]
  conversationStore: ConversationStore
  shutdown: () => Promise<void>
}

export async function startServer(config: AgentGateConfig, opts?: ServerOptions): Promise<AgentGateServer> {
  const bindingStore = new BindingStore()
  const sessionRegistry = new SessionRegistry()
  const handshake = new HandshakeManager(bindingStore)
  const conversationStore = new ConversationStore()
  const bus = new MemoryBus()
  const agentRegistry = new AgentRegistry()
  const router = new SessionRouter(bindingStore, agentRegistry, sessionRegistry)

  if (config.agents.length > 0) {
    for (const a of config.agents) {
      agentRegistry.register({ agent_id: a.id, name: a.name, description: a.description, capabilities: a.capabilities ?? [], status: 'idle', registered_at: new Date().toISOString() })
    }
  } else {
    agentRegistry.register({ agent_id: config.server.defaultAgent, name: 'Default Agent', description: 'Built-in agent', capabilities: ['chat', 'echo'], status: 'idle', registered_at: new Date().toISOString() })
  }

  const runtime = new AgentRuntime(bus, agentRegistry, router, conversationStore)
  runtime.setHandler(config.server.defaultAgent, async (envelope) => {
    const text = envelope.payload.text ?? ''
    return `[AgentGate] 已收到消息\n\n信道: ${envelope.channel}\n来源: ${envelope.channel_user_id}\n内容: ${text}\n\n— 来自 Agent "${config.server.defaultAgent}"`
  })
  runtime.start()

  const gateway = new ChannelGateway({ bindingStore, handshake, bus, defaultAgentId: config.server.defaultAgent })
  const adapters: ChannelAdapter[] = []

  if (!opts?.headless) {
    if (config.channels.rest?.enabled) {
      const ra = new RESTAdapter({ port: config.channels.rest.port, host: config.channels.rest.host, handshake, conversationStore, bus })
      ra.onMessage((raw: RawMessage) => { gateway.receive(raw).catch(err => console.error(`[Gateway] Error: ${err}`)) })
      adapters.push(ra)
    }
    if (config.channels.telegram?.enabled && config.channels.telegram.token) {
      const ta = new TelegramAdapter({ token: config.channels.telegram.token, apiRoot: config.channels.telegram.apiRoot, allowFrom: config.channels.telegram.allowFrom })
      ta.onMessage((raw: RawMessage) => { gateway.receive(raw).catch(err => console.error(`[Gateway] Error: ${err}`)) })
      adapters.push(ta)
    }
    if (config.channels.ssh?.enabled) {
      const sa = new SSHAdapter({ port: config.channels.ssh.port, host: config.channels.ssh.host, users: config.channels.ssh.users })
      sa.onMessage((raw: RawMessage) => { gateway.receive(raw).catch(err => console.error(`[Gateway] Error: ${err}`)) })
      adapters.push(sa)
    }

    const dispatcher = new OutboundDispatcher(adapters)
    dispatcher.attach(bus)

    for (const adapter of adapters) {
      await adapter.start()
    }
    console.log('[AgentGate] Server started')
  } else {
    console.log('[AgentGate] Server started (headless)')
  }

  let bridge: BridgeAgent | null = null
  let conversationSync: ConversationSync | null = null
  if (config.bridge?.enabled) {
    bridge = new BridgeAgent({ agentId: config.server.defaultAgent, bus, registryHost: config.bridge.host, registryPort: config.bridge.port })
    await bridge.start()
    conversationSync = new ConversationSync(bus, conversationStore)
    console.log(`[AgentGate]   Bridge v2: agent=${config.server.defaultAgent} port=${bridge.port}`)
  }

  const shutdown = async () => {
    console.log('[AgentGate] Shutting down...')
    if (conversationSync) conversationSync.stop()
    if (bridge) bridge.stop()
    for (const adapter of adapters) { try { await adapter.stop() } catch {} }
    bus.clear()
  }

  return { bus, agentRegistry, runtime, adapters, conversationStore, shutdown }
}
