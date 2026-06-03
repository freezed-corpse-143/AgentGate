#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { startServer } from './server.js'
import { BridgeAgent } from './bus/peer_bridge.js'
import { ConversationSync } from './storage/conversation_sync.js'
import { loadConfig } from './config.js'
import type { Envelope } from './types.js'

// Agent ID 解析优先级：CLI 参数 --agent-id > 文件 ~/.agentgate/agent_id
// 两个 Claude 实例可在 mcpServers 中用不同 args 区分身份
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// 解析 CLI 参数 --agent-id <value>
const agentIdArgIndex = process.argv.indexOf('--agent-id')
const cliAgentId = agentIdArgIndex !== -1 ? process.argv[agentIdArgIndex + 1] : undefined

let myAgentId: string
if (cliAgentId) {
  myAgentId = cliAgentId
} else {
  const AGENT_ID_FILE = join(process.env.AGENTGATE_DIR ?? join(homedir(), '.agentgate'), 'agent_id')
  myAgentId = 'default'
  try { mkdirSync(join(homedir(), '.agentgate'), { recursive: true }); if (existsSync(AGENT_ID_FILE)) { myAgentId = readFileSync(AGENT_ID_FILE, 'utf8').trim() } } catch {}
}

const myBridgePort = parseInt(process.env.AGENTGATE_BRIDGE_PORT ?? '0', 10)
const myBridgeHost = process.env.AGENTGATE_BRIDGE_HOST ?? '127.0.0.1'
const myRegistryPort = parseInt(process.env.AGENTGATE_REGISTRY_PORT ?? '8444', 10)

const config = loadConfig()
config.server.defaultAgent = myAgentId
if (myAgentId !== 'default') {
  process.env.AGENTGATE_DEFAULT_AGENT = myAgentId
}

const { bus, conversationStore, shutdown: coreShutdown } = await startServer(config, { headless: true })

// ─── Bridge v2 — 注册 + P2P 直连 ──────────────────
let bridge: BridgeAgent | null = null
let conversationSync: ConversationSync | null = null

const bridgeEnabled = process.env.AGENTGATE_BRIDGE_ENABLED !== 'false' && process.env.AGENTGATE_BRIDGE_ENABLED !== '0'
if (bridgeEnabled) {
  bridge = new BridgeAgent({
    agentId: myAgentId,
    bus,
    listenPort: myBridgePort,
    registryHost: myBridgeHost,
    registryPort: myRegistryPort,
  })
  await bridge.start()
  console.error(`[Bridge] Agent "${myAgentId}" listening on :${bridge.port}`)

  conversationSync = new ConversationSync(bus, conversationStore)
}

// ─── MCP Server ─────────────────────────────────────
const mcp = new Server(
  { name: 'agentgate', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {}, 'claude/channel/permission': {} },
    },
    instructions: [
      'You are connected to the AgentGate multi-agent network.',
      'Messages from other agents arrive as channel blocks.',
      'Use reply tool to respond, send_message to start new conversations.',
      'Use list_conversations to see all conversations.',
    ].join('\n'),
  },
)

// ─── 待处理消息队列 ────────────────────────────────
const pendingMessages: Array<{ from: string; text: string; conv_id: string }> = []

bus.subscribeWildcard('agent.*.inbound', (envelope: Envelope) => {
  const agentId = config.server.defaultAgent
  if (envelope.agent_id !== agentId) return
  const text = envelope.payload.text ?? ''
  pendingMessages.push({ from: envelope.channel_user_id, text, conv_id: envelope.conversation_id })
  conversationStore.appendMessage({
    message_id: envelope.message_id,
    conversation_id: envelope.conversation_id,
    agent_id: envelope.agent_id, role: 'user', text,
    channel: envelope.channel, channel_user_id: envelope.channel_user_id,
    timestamp: envelope.timestamp, metadata: { trace_id: envelope.trace_id },
  })
  mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content: text,
      meta: {
        chat_id: envelope.channel_user_id,
        message_id: envelope.message_id,
        user: envelope.channel_user_id,
        user_id: envelope.channel_user_id,
        agent_id: envelope.agent_id,
        conversation_id: envelope.conversation_id,
        trace_id: envelope.trace_id,
        source: envelope.channel,
        ts: envelope.timestamp,
      },
    },
  }).catch((err: unknown) => {
    process.stderr.write(`[AgentGate MCP] channel notification failed: ${err}\n`)
  })
})

// ─── 工具 ──────────────────────────────────────────
function drainPending(context: string): string {
  if (pendingMessages.length === 0) return context
  const notes = pendingMessages.map(p => `  🔔 ${p.from}: "${p.text.slice(0, 60)}" (conv: ${p.conv_id})`)
  const result = `${context}\n\n---\n📬 待处理消息 (${pendingMessages.length}):\n${notes.join('\n')}`
  pendingMessages.length = 0
  return result
}

const server = mcp

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'send_message',
      description: 'Send a NEW message to another agent. Use this to start a new conversation.',
      inputSchema: {
        type: 'object',
        properties: {
          target_agent_id: { type: 'string', description: 'Target agent ID, e.g. agent-beta.' },
          text: { type: 'string', description: 'Message text.' },
        },
        required: ['target_agent_id', 'text'],
      },
    },
    {
      name: 'reply',
      description: 'Reply to a conversation. Pass conv_id from the channel block or list_conversations.',
      inputSchema: {
        type: 'object',
        properties: {
          conv_id: { type: 'string', description: 'Conversation ID.' },
          text: { type: 'string', description: 'Reply text.' },
          target_agent_id: { type: 'string', description: 'Route to another agent.' },
        },
        required: ['conv_id', 'text'],
      },
    },
    {
      name: 'list_conversations',
      description: 'List recent conversations. Check this to see if new messages arrived.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max conversations to return.' },
        },
      },
    },
    {
      name: 'react',
      description: 'React with an emoji to acknowledge a message.',
      inputSchema: { type: 'object', properties: { conv_id: { type: 'string' }, emoji: { type: 'string' } }, required: ['conv_id', 'emoji'] },
    },
    {
      name: 'edit_message',
      description: 'Edit a previously sent reply.',
      inputSchema: { type: 'object', properties: { conv_id: { type: 'string' }, text: { type: 'string' } }, required: ['conv_id', 'text'] },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>

  switch (req.params.name) {
    case 'send_message': {
      const targetAgent = args.target_agent_id as string
      const text = args.text as string
      const convId = `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const msg: Envelope = {
        message_id: `mcp_${Date.now().toString(36)}`, trace_id: `trace_${Date.now().toString(36)}`,
        channel: 'agentgate', channel_user_id: config.server.defaultAgent,
        agent_id: targetAgent, conversation_id: convId,
        direction: 'inbound', type: 'text',
        payload: { text }, timestamp: new Date().toISOString(),
      }
      conversationStore.appendMessage({
        message_id: msg.message_id, conversation_id: convId,
        agent_id: config.server.defaultAgent, role: 'user', text,
        channel: 'agentgate', channel_user_id: config.server.defaultAgent,
        timestamp: msg.timestamp, metadata: { trace_id: msg.trace_id },
      })
      bus.publish(`agent.${targetAgent}.inbound`, msg)
      return { content: [{ type: 'text', text: drainPending(`sent to ${targetAgent}: ${text}`) }] }
    }

    case 'reply': {
      const text = args.text as string
      const targetAgent = args.target_agent_id as string | undefined
      const convId = args.conv_id as string
      const msgs = conversationStore.getMessages(convId, { limit: 1 })
      const original = msgs[0]
      const response: Envelope = {
        message_id: `mcp_${Date.now().toString(36)}`,
        trace_id: original?.metadata?.trace_id as string ?? `trace_${Date.now().toString(36)}`,
        channel: original?.channel ?? 'agentgate',
        channel_user_id: original?.channel_user_id ?? config.server.defaultAgent,
        agent_id: targetAgent ?? config.server.defaultAgent,
        conversation_id: convId, direction: 'outbound', type: 'agent_response',
        payload: { text }, timestamp: new Date().toISOString(),
      }
      conversationStore.appendMessage({
        message_id: response.message_id, conversation_id: convId,
        agent_id: response.agent_id, role: 'agent', text,
        channel: response.channel, channel_user_id: response.channel_user_id,
        timestamp: response.timestamp, metadata: { trace_id: response.trace_id },
      })
      if (targetAgent && targetAgent !== config.server.defaultAgent) {
        bus.publish(`agent.${targetAgent}.inbound`, response)
      } else {
        bus.publish(`agent.${response.agent_id}.outbound`, response)
      }
      return { content: [{ type: 'text', text: drainPending(`replied to ${convId}`) }] }
    }

    case 'list_conversations': {
      const limit = (args.limit as number) ?? 10
      const convs = conversationStore.listConversations().slice(0, limit)
      const result = convs.map((c: any) =>
        `${c.conversation_id}: ${c.agent_id}, ${c.message_count} msgs, last ${c.last_active_at}`
      ).join('\n') || '(no conversations)'
      return { content: [{ type: 'text', text: drainPending(result) }] }
    }

    case 'react':
      return { content: [{ type: 'text', text: drainPending(`reacted ${args.emoji}`) }] }

    case 'edit_message':
      return { content: [{ type: 'text', text: drainPending(`edited ${args.conv_id}`) }] }

    default:
      return { content: [{ type: 'text', text: drainPending(`unknown tool: ${req.params.name}`) }], isError: true }
  }
})

// ─── 优雅关闭 ──────────────────────────────────────
let shuttingDown = false
function gracefulShutdown(): void {
  if (shuttingDown) return; shuttingDown = true
  conversationSync?.stop()
  bridge?.stop()
  coreShutdown().catch(() => {}).finally(() => process.exit(0))
}
process.stdin.on('end', gracefulShutdown); process.stdin.on('close', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown); process.on('SIGINT', gracefulShutdown)

console.error('[AgentGate MCP] Starting...')
await mcp.connect(new StdioServerTransport())
console.error('[AgentGate MCP] Running')
