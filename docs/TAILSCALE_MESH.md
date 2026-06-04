# AgentGate Tailscale Networking

> Using Tailscale's virtual private network to enable direct communication between AgentGate agents on different machines.
> Zero configuration, zero port exposure, encrypted transport (WireGuard).

---

## 1. Background

Bridge v2 P2P direct connections have two hard requirements:
- Each machine needs a **reachable IP + port**
- Firewall/NAT must not block TCP connections

SSH tunnels can solve this but are cumbersome: manual port forwarding, tunnel updates for dynamic ports, reconnection on SSH disconnect.

**Tailscale creates a virtual LAN at the OS level**, giving each machine a fixed Tailscale IP (`100.x.x.x`). All machines then "appear to be on the same switch." AgentGate doesn't need to know about the underlying network differences.

### Comparison with SSH Tunnels

| Comparison | SSH Tunnel | Tailscale |
|------------|-----------|-----------|
| Installation | Built-in (Linux/Mac) | Requires Tailscale installation |
| Configuration | One `-L` per port | `tailscale up` once |
| Dynamic port changes | Need to update tunnel | Not needed (direct to machine) |
| NAT traversal | ❌ Requires public jump host | ✅ DERP relays |
| Encryption | SSH transport layer | WireGuard transport layer |
| Keepalive | `ServerAliveInterval` | Built-in heartbeat |
| Code changes | 0 | 0 |

---

## 2. Installation & Networking

### 2.1 Install Tailscale

Install Tailscale on each machine and log in to the same account.

```bash
# Linux
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# macOS
brew install tailscale && tailscale up

# Windows
# Download: https://tailscale.com/download
# Run and log in

# Verify
tailscale status
# 100.x.x.x  machine-a
# 100.x.x.y  machine-b
```

### 2.2 Verify Connectivity

```bash
# Machine A
ping 100.x.x.y
# → reachable

# Machine B
ping 100.x.x.x
# → reachable
```

---

## 3. Start AgentGate with Tailscale IPs

### 3.1 Architecture Diagram

```
Machine A (Tailscale IP 100.1.2.3)       Machine B (Tailscale IP 100.1.2.4)
┌─────────────────────────┐             ┌─────────────────────────┐
│ RegistryServer :8444    │◄────Tailscale────►│ agent-beta           │
│ Listening on 100.1.2.3  │   WireGuard Encrypt │ registryHost: 100.1.2.3│
│                         │             │ bridge port: auto       │
│ agent-alpha             │             │ P2P direct to Machine A │
│  registryHost: 127.0.0.1│             └─────────────────────────┘
└─────────────────────────┘
```

**Key difference**: Machines in the Tailscale network communicate using Tailscale IPs directly. BridgeAgent's `registryHost` is set to `100.x.x.x`, and P2P connections also go through `100.x.x.x`.

### 3.2 Start Registry (Machine A)

```bash
# Machine A — listen on Tailscale IP so other machines can connect
node dist/index.js bridge 8444

# Default listens on 0.0.0.0:8444
# Confirm reachable via Tailscale interface:
# tailscale ip -4 → 100.1.2.3
```

### 3.3 Start agent-alpha (Machine A, Local)

```bash
# Machine A
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
node dist/index.js start --bridge

# agent-alpha connects to 127.0.0.1:8444 (same-machine Registry)
# P2P port auto-assigned
```

### 3.4 Start agent-beta (Machine B, Cross-Machine)

```bash
# Machine B
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
$env:AGENTGATE_REGISTRY_HOST = "100.1.2.3"   # Machine A's Tailscale IP
$env:AGENTGATE_BRIDGE_HOST = "100.1.2.4"     # This machine's Tailscale IP (advertised to peers)
node dist/index.js start --bridge
```

Key log output:
```
[Bridge] Listening on 100.1.2.4:xxxxx
[Bridge] Connected to registry at 100.1.2.3:8444
[Bridge] Peer joined: agent-alpha (100.1.2.3:xxxxx)
[Bridge] P2P connected to agent-alpha
```

**No tunnels, no port forwarding, no SSH keepalive.**

---

## 4. Configuration Details

### 4.1 Environment Variables

| Variable | Value | Description |
|----------|-------|-------------|
| `AGENTGATE_REGISTRY_HOST` | `100.x.x.x` | Registry's Tailscale IP |
| `AGENTGATE_BRIDGE_HOST` | Local Tailscale IP | BridgeAgent registers with Tailscale IP instead of `127.0.0.1` |

### 4.2 `advertiseHost` — Declaring Local Address to Registry

The `BridgeAgentOptions.advertiseHost` field handles this:

```typescript
export interface BridgeAgentOptions {
  agentId: string
  bus: MessageBus
  listenPort?: number
  registryHost?: string
  registryPort?: number
  /** Host address advertised to the registry. For cross-machine communication, set to local Tailscale IP or public IP */
  advertiseHost?: string
}
```

Default value is `127.0.0.1` (backward-compatible, single-machine scenarios unaffected).
For cross-machine, set via `AGENTGATE_BRIDGE_HOST` environment variable or programmatically. **This feature is implemented and ready to use.**

### 4.3 Complete Configuration Example

```bash
# Machine A (Registry + agent-alpha)
node dist/index.js bridge 8444

$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
$env:AGENTGATE_BRIDGE_HOST = "100.1.2.3"   # Local Tailscale IP
node dist/index.js start --bridge

# Machine B (agent-beta)
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
$env:AGENTGATE_REGISTRY_HOST = "100.1.2.3" # Machine A's Tailscale IP
$env:AGENTGATE_BRIDGE_HOST = "100.1.2.4"   # Local Tailscale IP
node dist/index.js start --bridge

# Machine C (agent-gamma)
$env:AGENTGATE_DEFAULT_AGENT = "agent-gamma"
$env:AGENTGATE_REGISTRY_HOST = "100.1.2.3"
$env:AGENTGATE_BRIDGE_HOST = "100.1.2.5"
node dist/index.js start --bridge
```

---

## 5. Tailscale Advanced Tips

### 5.1 Using ACLs to Control Agent Access

```json
// Tailscale ACL (https://login.tailscale.com/admin/acls)
{
  "acls": [
    // Allow only Bridge port communication between agents
    {
      "action": "accept",
      "src":    ["tag:agent"],
      "dst":    ["tag:agent:*"]
    }
  ],
  "tagOwners": {
    "tag:agent": ["user@example.com"]
  }
}
```

### 5.2 Fixed Tailscale IP

```bash
# Tailscale IPs don't change by default, but may change on re-login
# Use MagicDNS for more stability:
tailscale up --accept-dns

# Then use machine names directly:
ping machine-a       # → 100.x.x.x
ping machine-b       # → 100.x.x.y
```

### 5.3 Internal-Only Machines (No Public IP)

Tailscale's DERP relays handle NAT traversal automatically. No public jump host needed.

---

## 6. Choosing Between SSH and Tailscale

| Your Environment | Recommended Approach |
|-----------------|---------------------|
| Existing public jump host, can't install Tailscale | SSH tunnels (`docs/SSH_MESH.md`) |
| All machines can install Tailscale | **Tailscale** (this document) |
| Mixed: some can install Tailscale, some can't | Tailscale primary, SSH tunnel as fallback |
| Single-machine test only | Nothing to do, `localhost` directly |

---

## 7. Summary

Tailscale benefits for AgentGate:

- **Zero code changes** (apart from adding `advertiseHost` option and `AGENTGATE_BRIDGE_HOST` environment variable)
- **Zero port management** — no `-L` forwarding needed, no concern about dynamic ports
- **Built-in encryption** — WireGuard transport layer encryption, no P2P protocol changes needed
- **Auto-keepalive** — built-in heartbeat, automatic reconnection on disconnect
- **NAT traversal** — DERP relays, no public server required
