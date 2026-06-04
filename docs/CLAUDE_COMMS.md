# Claude Dual-Instance Communication — Test Report & Protocol Analysis

> This document records the complete process of enabling direct communication between two Claude Code instances via AgentGate,
> including architecture design, test results, comparative analysis with the official Telegram plugin, and research on the `notifications/claude/channel` protocol.
>
> **Current status:** Bridge upgraded to v2 (decentralized registry + P2P direct connection). See `BRIDGE_PROTOCOL.md` for details.
> Architecture diagrams in this document correspond to the legacy Bridge v1 (hub + client mode), but the channel protocol analysis and notification debugging content remain valid.

---

## 1. Architecture Overview

### 1.1 Goal

Two Claude Code instances (processes), each loading the AgentGate MCP plugin, connect via an embedded TCP Bridge for cross-process message delivery. No external service dependencies.

### 1.2 Layered Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Claude A                    │  Claude B                     │
│  AGENTGATE_DEFAULT_AGENT    │   AGENTGATE_DEFAULT_AGENT     │
│  = agent-alpha              │   = agent-beta                │
│                             │                               │
│  ┌──────────────────────┐   │   ┌──────────────────────┐    │
│  │ MCP Server A         │   │   │ MCP Server B         │    │
│  │  - 5 tools           │   │   │  - 5 tools           │    │
│  │  - claude/channel    │   │   │  - claude/channel    │    │
│  │  capability           │   │   │  capability           │    │
│  └───────┬──────────────┘   │   └───────┬──────────────┘    │
│          │                  │           │                    │
│          ▼                  │           ▼                    │
│  ┌───────────────┐         │   ┌───────────────┐           │
│  │ BridgeClient  │◄──TCP──►│   │ BridgeClient  │           │
│  │ (peer/node)   │  :8444  │   │ (hub/server)  │           │
│  └───────────────┘         │   └───────────────┘           │
│         ▲                  │           ▲                    │
│         │                  │           │                    │
│  ┌──────┴───────┐         │   ┌──────┴───────┐            │
│  │ MemoryBus A  │         │   │ MemoryBus B  │            │
│  │ agent.*.in   │         │   │ agent.*.in   │            │
│  │ agent.*.out  │         │   │ agent.*.out  │            │
│  │ _system.*    │         │   │ _system.*    │            │
│  └──────────────┘         │   └──────────────┘            │
└─────────────────────────────┘──────────────────────────────┘
```

### 1.3 Message Flow

```
Claude A user says:
  "Use send_message to send a message to agent-beta"

  → Claude A calls MCP tool: send_message(target_agent_id="agent-beta", text="Hello")
    → MCP Server A handler:
      1. Create Envelope { agent_id: "agent-beta", text: "Hello" }
      2. conversationStore.appendMessage(...)  // write to local storage
      3. bus.publish("agent.agent-beta.inbound", envelope)
        → BridgeClient A wildcard catch
          → Send via TCP to BridgeServer (port 8444)
            → BridgeServer broadcasts to all clients except sender
              → BridgeClient B receives
                → bus.publish("agent.agent-beta.inbound", envelope)
                  → MCP Server B subscriber catches
                    → Check agent_id === "agent-beta" → match
                    → 1. conversationStore.appendMessage(...)   // store locally
                    → 2. pendingMessages.push(...)               // add to pending queue
                    → 3. mcp.notification({ method: 'notifications/claude/channel' })
```

---

## 2. Test Results

### 2.1 Environment

| Item | Value |
|------|-------|
| OS | Windows 11 |
| Claude Version | deepseek-v4-pro (claude.exe, 234MB Bun-compiled) |
| Launch Method | `claude --dangerously-load-development-channels server:agentgate` |
| Agent ID delivery | File `~/.agentgate/agent_id` (env vars not passed to MCP subprocess) |
| Bridge Port | 8444 (auto-networking: first starter = hub, subsequent = peers) |
| MCP SDK | `@modelcontextprotocol/sdk@^1.29.0` |

### 2.2 Verification Results

| Check | Result | Notes |
|-------|--------|-------|
| Bridge interconnection | ✅ | total: 2, both BridgeClients connected |
| send_message cross-process | ✅ | Message reaches the other agent's MemoryBus via bridge |
| Message stored in conversation store | ✅ | Both sides store independently, ConversationSync syncs cross-process |
| pendingMessages queue | ✅ | Unread messages queued, returned on next tool call |
| list_conversations works | ✅ | Other side can see new messages via list_conversations |
| notifications/claude/channel | ❌ | MCP notification sent, but Claude doesn't display it |

### 2.3 Known Issues

| Issue | Root Cause | Status |
|-------|------------|--------|
| Messages don't pop up automatically | `notifications/claude/channel` doesn't work in this version | ⚠️ Workaround available |
| Env vars not forwarded | Claude starts MCP subprocess without inheriting terminal env | ✅ Fixed with file reading |
| `reply` tool needs conv_id | Cross-process: local store may not have the conversation | ✅ Added send_message as alternative |

### 2.4 Real Usage Flow

```powershell
# Terminal A
echo agent-alpha > $env:USERPROFILE\.agentgate\agent_id
claude --dangerously-load-development-channels server:agentgate

# In Claude A:
# "Use send_message to send a message to agent-beta with text 'Hello'"

# Terminal B
echo agent-beta > $env:USERPROFILE\.agentgate\agent_id
claude --dangerously-load-development-channels server:agentgate

# In Claude B:
# "List recent conversations" → will see the new conversation
# Or just type anything — pending messages are appended to every tool response
```

---

## 3. Channel Protocol Deep Analysis

### 3.1 Channel Mechanism in MCP Protocol

`notifications/claude/channel` is an **experimental Claude Code extension**, not part of the standard MCP spec. Implementation involves three layers:

#### Layer 1: Capability Declaration

MCP Server declares channel support on initialization:

```typescript
const mcp = new Server(
  { name: 'agentgate', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},           // declare ability to inject messages
        'claude/channel/permission': {}, // declare ability to authenticate message sources
      },
    },
  },
)
```

When Claude receives the InitializeResponse with these experimental capabilities, it enables the channel feature if supported.

#### Layer 2: Sending Notification

MCP Server sends a JSON-RPC notification via `mcp.notification()`:

```typescript
mcp.notification({
  method: 'notifications/claude/channel',
  params: {
    content: "Message text",
    meta: {
      chat_id: "agent-alpha",
      agent_id: "agent-beta",
      conversation_id: "conv_xxx",
      trace_id: "trace_xxx",
      source: "agentgate",
      ts: "2026-06-03T04:48:02.698Z",
    },
  },
})
```

The MCP SDK serializes this as a JSON-RPC notification sent via stdio:
```json
{
  "jsonrpc": "2.0",
  "method": "notifications/claude/channel",
  "params": {
    "content": "Message text",
    "meta": { ... }
  }
}
```

#### Layer 3: Claude Client Processing

When Claude Code receives the JSON-RPC notification:
1. Parse method as `notifications/claude/channel`
2. Check if the MCP Server declared `claude/channel` capability
3. Check `~/.claude.json` for `tengu_harbor` configuration
4. If passed, render the message as a `<channel>` tag in the session context

### 3.2 `~/.claude.json` Configuration

```json
{
  "cachedGrowthBookFeatures": {
    "tengu_harbor": true,
    "tengu_harbor_ledger": [
      { "marketplace": "claude-plugins-official", "plugin": "discord" },
      { "marketplace": "claude-plugins-official", "plugin": "telegram" },
      { "marketplace": "local", "plugin": "agentgate" }
    ],
    "tengu_harbor_permissions": true
  }
}
```

`tengu_harbor_ledger` is the channel feature whitelist. `marketplace: "local"` entries correspond to plugins loaded via `--plugin-dir`.

### 3.3 Telegram Plugin vs AgentGate Implementation

| Aspect | Telegram Plugin | AgentGate |
|--------|-----------------|-----------|
| Runtime | Bun | Node.js |
| MCP SDK | `^1.0.0` | `^1.29.0` |
| Capability | `claude/channel` + `claude/channel/permission` | Identical |
| Notification method | `void mcp.notification({...})` fire-and-forget | `mcp.notification({...}).catch()` |
| Notification payload | `{ content, meta: { chat_id, user, user_id, ts } }` | `{ content, meta: { chat_id, agent_id, conversation_id, trace_id, source, ts } }` |
| Env passing | Via `.env` file for token | ✅ File reading for agent_id |
| Installation | Marketplace install | `--plugin-dir` |

**Core difference**: The notification format and calling method are **identical**. The Telegram plugin works while AgentGate doesn't. Possible reasons:

1. **Installation method**: Claude may treat marketplace plugins and `--plugin-dir` plugins differently
2. **Harbor ledger recognition**: `marketplace: "local"` entries may not be recognized
3. **Claude version restriction**: Channel feature may be gated behind specific Claude versions or models

### 3.4 MCP SDK Notification Sending Flow

In `@modelcontextprotocol/sdk`, the `notification()` method:

```
Server.notification(params)
  → Protocol.notification(params)         // inherited from Protocol class
    → assertNotificationCapability(method) // check if method is allowed by capabilities
      → switch(method):
          'notifications/message'          → requires logging capability
          'notifications/resources/*'      → requires resources capability
          'notifications/tools/*'          → requires tools capability
          'notifications/prompts/*'        → requires prompts capability
          'notifications/cancelled'        → always allowed
          'notifications/progress'         → always allowed
          'notifications/claude/channel'   → no matching case → passes through ✅
    → transport.send(message)             // send JSON-RPC via stdio
```

Key finding: `assertNotificationCapability()` has no case for `notifications/claude/channel`, so it passes through without error and without being blocked.

---

## 4. Bridge Protocol

### 4.1 Transport Layer

TCP + newline-delimited JSON (JSON Lines)

```
→ {"type":"hello","node_id":"node-DESKTOP-7E8RPQH-12345"}
→ {"type":"message","topic":"agent.agent-beta.inbound","envelope":{...}}
→ {"type":"heartbeat"}
← {"type":"heartbeat_ack"}
```

### 4.2 Auto-Networking

On each MCP Server startup:
1. Attempt to start BridgeServer on port 8444 (listen on 0.0.0.0)
2. If port is occupied → the other instance is the Server, this instance becomes Client
3. Simultaneously start BridgeClient connecting to 127.0.0.1:8444 (regardless of Server or Client role)

No configuration files needed, no separate bridge service to start.

### 4.3 Message Topics

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `agent.{id}.inbound` | → | Agent inbound messages |
| `agent.{id}.outbound` | ← | Agent outbound replies |
| `_system.*` | → | System internal messages |
| `_system.conversation.*` | → | Conversation sync |

---

## 5. Pending Message Mechanism

Since `notifications/claude/channel` push doesn't work, a pull-based workaround is implemented:

1. Inbound messages arrive → stored in `pendingMessages[]` queue
2. Next time Claude calls any MCP tool
3. Response appends:

```
📬 Pending Messages (1):
  🔔 agent-alpha: "Hello" (conv: conv_xxx)

Use reply tool to respond, conv_id as above.
```

4. Queue is cleared after returning

---

## 6. MCP SDK notification() Call Chain

```
mcp.notification({ method: 'notifications/claude/channel', params })
  → Protocol.notification()
    → assertNotificationCapability('notifications/claude/channel')
      → switch('notifications/claude/channel'):
          // no matching case → no error, passes through
    → this._transport.send(jsonRpcMessage)
      → StdioServerTransport.send()
        → process.stdout.write(JSON.stringify(message))
```

**Key finding**: `assertNotificationCapability()` only checks standard MCP notification methods:
`notifications/message`, `notifications/resources/*`, `notifications/tools/*`,
`notifications/prompts/*`, `notifications/cancelled`, `notifications/progress`.

`notifications/claude/channel` is not in any case → **no error, not blocked** → sent directly.

This means:
1. MCP SDK side ✅ — notification was sent to Claude via stdio
2. Claude side ❌ — received but not processed/displayed

---

## 7. Conclusion: Why Push Doesn't Work

| Reason | Likelihood | Notes |
|--------|------------|-------|
| `--plugin-dir` vs marketplace treatment | High | Telegram plugin installed via marketplace may have different permissions |
| Harbor ledger config not recognized | Medium | `marketplace: "local"` entries may not be recognized by Claude |
| Claude version restriction | Medium | Channel feature may be gated behind specific versions/models |
| `.catch()` on mcp.notification | Low | `mcp.notification()` is indeed called |
| MCP SDK version difference | Low | 1.0.0 vs 1.29.0 notification methods are consistent |

---

## 8. Extracting claude.exe with unbuned

Successfully used [unbuned](https://github.com/vibheksoni/unbuned) to extract Claude source:

```bash
python unbuned.py claude.exe
# → output/claude/claude.js (15,335,959 bytes, 15MB)
```

### Findings

1. **Code is fully minified** — all variable names shortened to single letters (`H`, `$`, `A`, `L`, `D` etc.), making specific logic analysis difficult
2. **Connection types** — Claude uses multiple connection methods:
   - MCP stdio (stdin/stdout JSON-RPC)
   - Chrome Bridge WebSocket (for browser automation)
3. **Key finding**: In the bridge connection handler:
   ```javascript
   case"notification":if(this.notificationHandler)
     this.notificationHandler({method:H.method,params:H.params});
   ```
   This confirms Claude processes plugin notifications via `notificationHandler`
4. **`tengu` references** — Several occurrences of `tengu` as event tracing/marking identifiers
5. **`claude/channel` capability** — Found in MCP Server initialization code for experimental capabilities

### Limitations

- 15MB of minified JS cannot be effectively searched for specific logic
- All variable names are shortened, making function inference impossible
- Actual channel notification rendering logic may be in compiled bytecode, not the JS bundle

### Comparison with wakaru

| Tool | Result |
|------|--------|
| wakaru | ❌ Cannot handle Bun-compiled PE binaries |
| unbuned | ✅ Successfully extracted 15MB minified JS, but code is heavily obfuscated |

claude.exe (234MB) is a **Bun-compiled single-file binary** containing compiled bytecode.
JavaScript source is compiled into Bun's internal format, unrecoverable by wakaru (JS/TS decompiler).

Analyzable public resources:
- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/telegram/server.ts` — Telegram plugin full source
- `node_modules/@modelcontextprotocol/sdk/` — MCP SDK fully open source
- `~/.claude.json` — Claude config file (channel/harbor configuration)

---

## 9. Test Command Reference

```bash
# Build
cd C:\Projects\AgentGate && npm run build

# Sync plugin
npm run build

# Set agent_id
echo agent-alpha > $env:USERPROFILE\.agentgate\agent_id

# Start Claude
claude --dangerously-load-development-channels server:agentgate

# Test MCP server standalone
node dist/mcp_server.js

# Run tests
npx vitest run tests/unit tests/integration
npm run test:telegram
```
