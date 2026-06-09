# AgentGate — Multi-Agent Communication Infrastructure

[![CI](https://github.com/freezed-corpse-143/AgentGate/actions/workflows/ci.yml/badge.svg)](https://github.com/freezed-corpse-143/AgentGate/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D22-brightgreen)](https://nodejs.org/)

AgentGate is a **multi-channel agent communication infrastructure** that connects agents across processes and machines. It leverages the `notifications/claude/channel` mechanism to inject messages into Claude sessions and uses the decentralized Bridge v2 protocol for P2P direct connectivity between agents.

**No dependency on Telegram API or any external service.** Core mechanism inspired by the official Telegram plugin's context injection pattern.

AgentGate supports **multiple channel adapters**: REST/WebSocket/SSE, Telegram Bot (single or multi-instance), SSH, and an in-process broadcast adapter for system-wide messaging.

---

## Quick Start

### Prerequisites

- Node.js 22+
- Claude Code v2.1.160+ (tested with v2.1.169)
- `~/.claude.json` configured (see below)

### Installation

#### Option A: Clone from GitHub (recommended)

```bash
git clone https://github.com/freezed-corpse-143/AgentGate.git
cd AgentGate
npm install
npm run build
```

#### Option B: Use Claude Plugin Directory

```bash
claude --plugin-dir /path/to/AgentGate
```

The MCP server auto-starts from `~/.claude.json` configuration. No special flags needed.

### Configure `~/.claude.json`

Replace `<AGENTGATE_DIR>` with your actual path (e.g. `/home/user/AgentGate` or `C:\Users\name\AgentGate`):

```json
{
  "mcpServers": {
    "agentgate": {
      "command": "node",
      "args": [
        "<AGENTGATE_DIR>/dist/mcp_server.js",
        "--agent-id",
        "${AGENTGATE_DEFAULT_AGENT}"
      ]
    }
  }
}
```

> `${AGENTGATE_DEFAULT_AGENT}` is an environment variable placeholder. Claude replaces it with the actual value before launching the MCP process.
> Each Claude instance can differentiate itself by setting a different variable value, no config file changes needed.

### Build

```bash
npm run build
```

### Start (Single Instance)

```bash
# Linux/macOS
AGENTGATE_DEFAULT_AGENT=agent-alpha claude --plugin-dir /path/to/AgentGate

# Windows PowerShell
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
claude --plugin-dir C:\Projects\AgentGate
```

### Dual-Instance Communication

```bash
# Terminal A
AGENTGATE_DEFAULT_AGENT=agent-alpha claude --plugin-dir /path/to/AgentGate

# Terminal B
AGENTGATE_DEFAULT_AGENT=agent-beta claude --plugin-dir /path/to/AgentGate
```

Once running, use the `send_message` tool in any instance — the other side automatically receives a `<channel>` block in its context.

---

## Architecture

```
┌─ Claude A (agent-alpha) ────────────────────┐
│                                              │
│  MCP Server (mcp_server.js)                 │
│    ├── send_message / reply / react          │
│    ├── list_conversations / edit_message     │
│    └── notifications/claude/channel          │
│                                              │
│  BridgeAgent (:18445)                        │
│    ├── RegistryClient → Registry :8444       │
│    ├── PeerManager → P2P connections         │
│    └── RetryQueue — exponential backoff      │
│                                              │
│  BroadcastAdapter — process-wide broadcast   │
│  SubscriptionManager — topic-pattern push    │
└───────────────┬──────────────────────────────┘
                │ P2P TCP
                ▼
┌─ Claude B (agent-beta) ─────────────────────┐
│                                              │
│  BridgeAgent (:18446)                        │
│    ├── RegistryClient → Registry :8444       │
│    ├── PeerManager → P2P connections         │
│    └── RetryQueue — exponential backoff      │
│                                              │
│  MCP Server (mcp_server.js)                 │
│    ├── 5 tools                              │
│    └── notifications/claude/channel          │
│                                              │
│  BroadcastAdapter — process-wide broadcast   │
│  SubscriptionManager — topic-pattern push    │
└──────────────────────────────────────────────┘
```

### Message Flow

```
Claude A user: "Use send_message to send a message to agent-beta"

1. Claude A calls MCP tool: send_message(target_agent_id="agent-beta", ...)
2. Envelope published to MemoryBus → agent.agent-beta.inbound
3. BridgeAgent.routeToPeer("agent-beta", ...) → P2P TCP direct connection
   → If send fails, RetryQueue enqueues with exponential backoff (1s-60s, max 8 tries)
4. Beta's BridgeAgent receives → bus.publish(...)
5. Beta's MCP Server subscriber triggers → mcp.notification(notifications/claude/channel)
6. Beta's Claude receives → <channel source="agentgate" ...> appears in context
```

---

## Bridge v2 Protocol

Decentralized registry + P2P direct connections. See [docs/BRIDGE_PROTOCOL.md](docs/BRIDGE_PROTOCOL.md).

| Component | Description |
|-----------|-------------|
| **Registry** | Fixed port 8444, self-bootstrapped by the first agent. Manages agent list, broadcasts join/leave |
| **P2P Direct** | Direct TCP communication between agents, no registry relay |
| **Port Allocation** | OS auto-assigned by default, can be set via `AGENTGATE_BRIDGE_PORT` |
| **Heartbeat** | 15s interval, 60s timeout disconnect |
| **RetryQueue** | Exponential backoff retry (1s→60s, max 8 attempts), drains on peer reconnect |
| **Advertise Host** | Use `AGENTGATE_BRIDGE_HOST` to advertise a Tailscale/public IP for cross-machine P2P |
| **Registry Secret** | Set `AGENTGATE_REGISTRY_SECRET` to require HMAC-signed registrations for multi-machine security |
| **Agent Pairing** | Use `request_pairing` / `verify_pairing` tools for agent-to-agent trust verification |

---

## Channel Adapters

| Adapter | Type | Description |
|---------|------|-------------|
| **REST Adapter** | `rest_adapter.ts` | HTTP POST, WebSocket (`/v1/stream`), SSE (`/v1/events`), dashboard, handshake endpoints |
| **Telegram Adapter** | `telegram_adapter.ts` | Grammy-based long-polling bot. Supports single or multi-instance (`telegrams[]`) |
| **SSH Adapter** | `ssh_adapter.ts` | SSH server with password/pubkey auth, shell + exec modes |
| **Broadcast Adapter** | `broadcast_adapter.ts` | Process-internal broadcast on `_broadcast` topic. Loop prevention via seenIds Set |

---

## MCP Tools

| Tool | Purpose |
|------|---------|
| `send_message` | Send a new message to another agent. Takes `target_agent_id` and `text` |
| `reply` | Reply to a conversation. Takes `conv_id`, `text`, optional `target_agent_id` for cross-instance routing |
| `list_conversations` | List recent conversations |
| `react` | Emoji reaction to a message |
| `edit_message` | Edit a previously sent reply (with edit history tracking) |
| `get_status` | Check system status: peers, pending messages, push mode |
| `request_pairing` | Generate a 6-digit pairing code for agent-to-agent trust |
| `verify_pairing` | Verify a pairing code from another agent |

> **Known limitation:** `notifications/claude/channel` push does not work with `--plugin-dir` loading in Claude v2.1.169. Messages arrive via pull-based pending messages queue — appended to the next tool response. Set `AGENTGATE_PUSH_MODE=off` to disable channel attempts.

Every tool response includes any **pending messages** (inbound messages queued since the last tool call), listed as:

```
📬 ── 2 NEW MESSAGES ─────────────────────
  🔔 agent-alpha: "Hello!"
     conv: conv_xxx
  🔔 agent-gamma: "How are you?"
     conv: conv_yyy
──────────────────────────────────────────
Use reply or send_message to respond.
```

---

## SubscriptionManager — Topic-Based Push

The `SubscriptionManager` allows external users to subscribe to topic patterns. When matching Envelopes pass through the bus, notifications are automatically pushed via the appropriate channel adapter.

**Use cases:**
- Subscribe to `agent.*.inbound` → receive all agent inbound messages
- Subscribe to `agent.agent-alpha.outbound` → receive replies from a specific agent
- Subscribe to `_broadcast` → receive all broadcast notifications

**Glob-style patterns:** `agent.*.inbound`, `agent.agent-alpha.*`, `_broadcast`

---

## Project Structure

```
src/
  mcp_server.ts              — MCP Server entry point (Claude integration)
  server.ts                  — Server bootstrap & wiring
  config.ts                  — Config loading (YAML + env overrides)
  types.ts                   — Core type definitions
  index.ts                   — CLI entry point (Commander)

  bus/
    memory_bus.ts            — In-memory pub/sub message bus
    peer_bridge.ts           — Bridge v2: decentralized registry + P2P
    outbound_dispatcher.ts   — Route outbound envelopes to adapters
    retry_queue.ts           — Exponential-backoff P2P retry queue

  agents/
    registry.ts              — Agent registry (find/list/register)
    runtime.ts               — Message routing + loop detection

  auth/
    binding_store.ts         — Channel↔Agent binding persistence
    handshake.ts             — Pairing code generation & verification

  channels/
    base.ts                  — ChannelAdapter interface
    rest_adapter.ts          — REST/WebSocket/SSE adapter
    telegram_adapter.ts      — Telegram bot adapter (grammy)
    ssh_adapter.ts           — SSH server adapter
    broadcast_adapter.ts     — In-process broadcast adapter

  gateway/
    channel_gateway.ts       — RawMessage→Envelope gateway
    envelope.ts              — Envelope factory, validation, loop detection

  sessions/
    router.ts                — Envelope→session→agent routing
    session_registry.ts      — Session lifecycle management

  storage/
    conversation_store.ts    — Message persistence (JSON files)
    conversation_sync.ts     — Cross-process conversation sync

  subscriptions/
    manager.ts               — Topic-pattern subscription/push engine

.mcp.json                  — MCP server registration
.claude-plugin/            — Plugin manifest
skills/                    — Skill plugins

docs/
  BRIDGE_PROTOCOL.md         — Bridge v2 protocol specification
  CLAUDE_COMMS.md            — Channel protocol analysis & test report
  DEBUG.md                   — Debugging guide
  DIAGNOSTICS.md             — Layered diagnostic manual
  SSH_MESH.md                — SSH cross-host networking
  TAILSCALE_MESH.md          — Tailscale cross-host networking

tests/
  unit/                      — 10 files, 85 tests
  integration/               — Integration tests
  e2e/                       — End-to-end tests
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTGATE_DEFAULT_AGENT` | `default` | Current agent's identity ID |
| `AGENTGATE_BRIDGE_PORT` | `0` (auto) | Bridge listen port for this agent |
| `AGENTGATE_BRIDGE_HOST` | `127.0.0.1` | Advertised host address (set to Tailscale IP for cross-machine) |
| `AGENTGATE_REGISTRY_PORT` | `8444` | Registry port |
| `AGENTGATE_REGISTRY_HOST` | `127.0.0.1` | Registry address |
| `AGENTGATE_DIR` | `~/.agentgate` | Data directory |
| `AGENTGATE_BRIDGE_ENABLED` | `true` | Set to `false` or `0` to disable bridge |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token (alternative to config file) |

### Config File (`agentgate.yaml` or `~/.agentgate/config.yaml`)

```yaml
server:
  defaultAgent: default

channels:
  rest:
    enabled: true
    port: 3000
    host: 0.0.0.0

  telegram:
    enabled: false
    token: ""                     # or set via TELEGRAM_BOT_TOKEN
    apiRoot: ""                   # custom API root (testing)

  telegrams:                      # multi-bot array
    - token: "123456:ABC"
      allowFrom: [admin]
    - token: "789012:DEF"

agents:
  - id: default
    name: Default Agent
    description: Built-in default agent
    capabilities: [chat, echo]

logging:
  level: info                     # debug | info | warn | error
```

---

## Development

```bash
# Build
npm run build

# Test
npx vitest run tests/unit            # 85 unit tests
npx vitest run tests/integration     # integration tests

# Health check
node dist/index.js health            # human-readable
node dist/index.js health --json     # machine-readable

# Type check
npm run typecheck

# Start Claude (single instance)
AGENTGATE_DEFAULT_AGENT=agent-alpha claude --plugin-dir /path/to/AgentGate
```

---

## Reference

### Documentation
- [docs/BRIDGE_PROTOCOL.md](docs/BRIDGE_PROTOCOL.md) — Bridge v2 protocol
- [docs/CLAUDE_COMMS.md](docs/CLAUDE_COMMS.md) — Channel protocol analysis & test report
- [docs/DEBUG.md](docs/DEBUG.md) — Debugging guide
- [docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md) — Layered diagnostic manual
- [docs/SSH_MESH.md](docs/SSH_MESH.md) — SSH cross-host networking
- [docs/TAILSCALE_MESH.md](docs/TAILSCALE_MESH.md) — Tailscale cross-host networking

### CI/CD
- `.github/workflows/ci.yml` — GitHub Actions: typecheck + unit tests + integration tests + build
- `Dockerfile` — Multi-stage build, production image ~100MB+
- Tests: `npm test` (unit + integration, excludes e2e), `npm run typecheck`
