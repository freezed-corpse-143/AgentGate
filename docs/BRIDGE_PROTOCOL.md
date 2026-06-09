# AgentGate Bridge Protocol v2

> Decentralized agent registration and P2P communication protocol.
> Agents read this document to learn how to configure ports, register themselves, discover other agents, and establish direct connections.

---

## 0. Quick Start

### Prerequisites

- Node.js 24+
- `~/.claude.json` configured with `mcpServers.agentgate` (see below)
- Project built: `npm run build`

### Configure `~/.claude.json`

```json
{
  "mcpServers": {
    "agentgate": {
      "command": "node",
      "args": [
        "C:\\Projects\\AgentGate\\dist\\mcp_server.js",
        "--agent-id",
        "${AGENTGATE_DEFAULT_AGENT}"
      ]
    }
  },
  "cachedGrowthBookFeatures": {
    "tengu_harbor": true,
    "tengu_harbor_permissions": true
  }
}
```

> `${AGENTGATE_DEFAULT_AGENT}` is an environment variable placeholder. Claude replaces it with the current env value before launching the MCP subprocess.
> Each Claude instance can differentiate itself with a different value — no config file changes needed.

### Single Instance Start

```powershell
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
claude --plugin-dir /path/to/AgentGate
```

First launch requires pressing Enter to confirm the dangerous mode warning. Subsequent launches can use `--dangerously-skip-permissions`.

### Dual-Instance Start (Two Terminals)

```powershell
# Terminal A
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
claude --plugin-dir /path/to/AgentGate

# Terminal B
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
claude --plugin-dir /path/to/AgentGate
```

After startup:
1. The first Claude instance self-bootstraps as the registry (listening on :8444)
2. The second Claude instance connects to the registry and discovers the first agent's address
3. Both establish a P2P direct connection
4. Use `send_message` tool in any Claude instance — the other side automatically receives a `<channel>` block

### Triple-Instance Start

```powershell
# Terminal A
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
$env:AGENTGATE_BRIDGE_PORT = "18445"     # Optional: specify Bridge port
claude --plugin-dir /path/to/AgentGate

# Terminal B
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
$env:AGENTGATE_BRIDGE_PORT = "18446"
claude --plugin-dir /path/to/AgentGate

# Terminal C
$env:AGENTGATE_DEFAULT_AGENT = "agent-gamma"
$env:AGENTGATE_BRIDGE_PORT = "18447"
claude --plugin-dir /path/to/AgentGate
```

All agents discover each other through the registry and establish a fully-connected P2P network.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Bridge Network                                  │
│                                                                     │
│  Registry (:8444)          agent-alpha (:18445)   agent-beta (:18446)│
│  ┌────────────────┐      ┌──────────────┐       ┌──────────────┐   │
│  │ RegistryServer │◄────►│ PeerManager   │◄────►│ PeerManager   │   │
│  │                │      │              │       │              │   │
│  │ peers:         │      │ Registry     │       │ Registry     │   │
│  │  alpha:18445   │      │ Client       │       │ Client       │   │
│  │  beta :18446   │      │              │       │              │   │
│  │  gamma:18447   │      │ RetryQueue   │       │ RetryQueue   │   │
│  └────────────────┘      └──────┬───────┘       └──────┬───────┘   │
│                                 │                      │           │
│                           Direct TCP (P2P) ◄──────────►│           │
└─────────────────────────────────────────────────────────────────────┘
```

### Roles

| Role | Description | Count |
|------|-------------|-------|
| **Registry** | Maintains the online agent list. The first agent to start self-bootstraps as the registry | 1 (fixed port 8444) |
| **Normal Agent** | Registers with the registry, then communicates directly with peers | Any number |

---

## 2. Port Allocation

### Registry Port

**Fixed at 8444**. The first agent to start launches a RegistryServer on this port and becomes the registry.

### Normal Agent Ports

**Configurable, OS auto-assigned by default.** Priority:

```
1. Environment variable AGENTGATE_BRIDGE_PORT → specified port
2. File ~/.agentgate/ports/<agent_id> → persisted last port
3. OS auto-assignment (port 0) → random available port
```

Configuration methods:

```powershell
# Method A: Environment variable
$env:AGENTGATE_BRIDGE_PORT = "18445"
claude --plugin-dir /path/to/AgentGate

# Method B: Persisted file
echo 18445 > ~\.agentgate\ports\agent-alpha

# Method C: Auto-assignment
claude --plugin-dir /path/to/AgentGate
```

---

## 3. Protocol Message Format

All messages are **JSON Lines** (`\n` delimited) over TCP.

### 3.1 Registration Phase

#### REGISTER — Agent registers with the registry

```json
{
  "type": "register",
  "agent_id": "agent-alpha",
  "host": "127.0.0.1",
  "port": 18445,
  "ts": "2026-06-03T14:00:00.000Z"
}
```

#### REGISTER_ACK — Registry confirmation

```json
{
  "type": "register_ack",
  "agent_id": "agent-alpha",
  "peers": [
    { "agent_id": "agent-beta", "host": "127.0.0.1", "port": 18446, "seen_at": "2026-06-03T13:59:00.000Z" }
  ]
}
```

The `peers` array contains **all currently online agents except the requester**. Direct connections should be established immediately upon receipt.

#### PEER_JOIN — Registry broadcasts new agent arrival

```json
{
  "type": "peer_join",
  "agent_id": "agent-gamma",
  "host": "127.0.0.1",
  "port": 18447
}
```

The registry broadcasts this to **all already-connected agents**. Recipients should connect to the new peer.

#### PEER_LEAVE — Agent offline notification

```json
{
  "type": "peer_leave",
  "agent_id": "agent-gamma"
}
```

Sent when:
- An agent exits normally and sends UNREGISTER
- The registry detects TCP disconnection

#### UNREGISTER — Agent voluntarily goes offline

```json
{
  "type": "unregister",
  "agent_id": "agent-alpha"
}
```

The registry broadcasts PEER_LEAVE and closes the connection.

### 3.2 Communication Phase

#### MESSAGE — Cross-agent message

```json
{
  "type": "message",
  "topic": "agent.agent-beta.inbound",
  "envelope": {
    "message_id": "msg_xxx",
    "trace_id": "trace_xxx",
    "channel": "agentgate",
    "channel_user_id": "agent-alpha",
    "agent_id": "agent-beta",
    "conversation_id": "conv_xxx",
    "direction": "inbound",
    "type": "text",
    "payload": { "text": "Hello!" },
    "timestamp": "2026-06-03T14:00:00.000Z"
  }
}
```

**Routing rules** (determined by `sendToPeer()`):

| topic match | Behavior |
|-------------|----------|
| `agent.{agent_id}.inbound` | Forward to the agent's peer |
| `agent.{agent_id}.outbound` | Forward to the agent's peer |
| `_system.*` | Forward to all peers |
| `_system.conversation.*` | Forward to all peers |

### 3.3 Heartbeat

```json
{"type": "heartbeat"}
{"type": "heartbeat_ack"}
```

Heartbeats only occur **between direct peers**, not through the registry. 60-second timeout without response triggers disconnection.

---

## 4. RetryQueue — P2P Message Retry

When P2P delivery fails (peer offline, socket unwritable), messages enter the `RetryQueue` for automatic retry.

### Design

- **Per-agent bucketing**: messages are grouped by `target_agent_id`, independent per peer
- **Exponential backoff**: 1s → 2s → 4s → 8s → ... → 60s max
- **Max retries**: 8 attempts before dead-letter
- **Drain on reconnect**: `drain(targetAgentId)` immediately flushes the queue when a peer reconnects
- **Dead-letter callback**: `onDeadLetter` fires for exhausted retries

### Retry Flow

```
P2P send fails → enqueue(envelope, targetAgentId, topic)
  → tick() every 2s checks due messages
    → socket.write() on reconnect
      → success: removed from queue
      → failure: attempt++ → rescheduled with backoff
        → 8 attempts exhausted → dead-letter
```

### Dead Letter Handling

```typescript
retryQueue.onDeadLetter = (envelope, agentId, reason) => {
  console.error(`[RetryQueue] DEAD LETTER ${envelope.message_id} → ${agentId}: ${reason}`)
}
```

---

## 5. Advertise Host for Cross-Machine

By default, agents register with `127.0.0.1` as their address. For cross-machine communication (e.g., via Tailscale), set `AGENTGATE_BRIDGE_HOST` to the machine's routable IP:

```typescript
export interface BridgeAgentOptions {
  agentId: string
  bus: MessageBus
  listenPort?: number
  registryHost?: string
  registryPort?: number
  /** Host address advertised to the registry. Set to Tailscale IP or public IP for cross-machine P2P */
  advertiseHost?: string
}
```

Default is `127.0.0.1` (backward-compatible, single-machine scenarios unaffected).

---

## 6. Lifecycle

### 6.1 Startup Flow

```
1. Read config (port / agent_id)
2. Start BridgeServer (listen on own port)
3. Connect to registry (:8444)
4. Send REGISTER → receive REGISTER_ACK
5. Establish direct connections from REGISTER_ACK.peers
6. Listen for PEER_JOIN → connect to new peers
7. Enter communication phase
```

### 6.2 Registry Self-Bootstrap

The first agent to start launches a RegistryServer on 8444. When subsequent agents connect to 8444:

- If connection succeeds → normal agent
- If connection fails (port in use) → normal agent, don't bootstrap
- If connection fails (nothing listening on 8444) → self-bootstrap as registry

**Edge case**: If the registry crashes, existing P2P connections **remain unaffected**, but new agents can't join. Recovery: restart any agent — it will attempt to self-bootstrap as the new registry.

### 6.3 Disconnect Detection

| Detection Method | Target | Timeout |
|-----------------|--------|---------|
| TCP disconnect event | All connections | Immediate |
| Heartbeat timeout | Peer direct connections | 60s |
| Registry detects TCP disconnect | Normal agents | Immediate |

---

## 7. Configuration

### 7.1 `~/.claude.json` Configuration

```json
{
  "mcpServers": {
    "agentgate": {
      "command": "node",
      "args": [
        "C:\\Projects\\AgentGate\\dist\\mcp_server.js",
        "--agent-id", "${AGENTGATE_DEFAULT_AGENT}"
      ]
    }
  }
}
```

**Key point:** `${AGENTGATE_DEFAULT_AGENT}` is an **environment variable placeholder**. Claude resolves `${var}` syntax in `~/.claude.json` by substituting the current process environment variable value — **before** spawning the MCP subprocess.

This means two Claude instances can share the same `~/.claude.json`. They differentiate by setting different environment variable values before startup.

### 7.2 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTGATE_DEFAULT_AGENT` | `default` | Current agent's identity ID |
| `AGENTGATE_BRIDGE_PORT` | `0` (auto) | Bridge listen port for this agent |
| `AGENTGATE_BRIDGE_HOST` | `127.0.0.1` | Advertised host address (for cross-machine P2P) |
| `AGENTGATE_REGISTRY_PORT` | `8444` | Registry port |
| `AGENTGATE_REGISTRY_HOST` | `127.0.0.1` | Registry address |
| `AGENTGATE_DIR` | `~/.agentgate` | Data directory |

### 7.3 Startup Examples

```powershell
# Terminal A — self-bootstrap as registry
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
$env:AGENTGATE_BRIDGE_PORT = "18445"
claude --plugin-dir /path/to/AgentGate

# Terminal B — normal agent
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
$env:AGENTGATE_BRIDGE_PORT = "18446"
claude --plugin-dir /path/to/AgentGate

# Terminal C — auto-assigned port
$env:AGENTGATE_DEFAULT_AGENT = "agent-gamma"
claude --plugin-dir /path/to/AgentGate
```

---

## 8. Comparison with v1

| Aspect | v1 (legacy) | v2 (current) |
|--------|-------------|--------------|
| Port | Fixed 8444 (all agents) | Per-agent independent port |
| Registry | Implicit self-bootstrap | Explicit REGISTER protocol |
| Message routing | Hub relay | P2P direct connection |
| Disconnect detection | TCP disconnect only | TCP disconnect + heartbeat |
| Configuration | Environment variables | Environment variables + file persistence |
| Retry on failure | None | RetryQueue with exponential backoff |
| Cross-machine | Not supported | advertiseHost + RetryQueue |
| Documentation | None | This document |

---

## 9. Implementation Checklist

- [x] `RegistryServer` — listen on 8444, handle REGISTER/UNREGISTER, broadcast PEER_JOIN/PEER_LEAVE
- [x] `RegistryClient` — register with registry, maintain peer list
- [x] `PeerConnection` — direct TCP management, heartbeat, reconnection
- [x] `PeerManager` — manage all peer connections, route messages by topic
- [x] Port allocation strategy — environment variable > file > auto
- [x] Bootstrap logic — try connect 8444, fall back to self-bootstrap
- [x] Legacy BridgeServer/BridgeClient removal
- [x] `RetryQueue` — exponential backoff, drain on reconnect, dead-letter
