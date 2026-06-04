# AgentGate SSH Mesh Networking

> Using SSH tunnels to connect AgentGate Bridge Agents running on different machines.
> Suitable for cross-host agent collaboration scenarios.

---

## 1. Background

The Bridge v2 registry discovery and P2P direct connections only work within **single-machine localhost** by default. When agents run on different hosts:

- Registry port 8444 is inaccessible across hosts (unless the port is exposed)
- P2P direct TCP connections are blocked by firewalls/NAT
- A secure cross-host tunnel solution is needed

SSH is the natural choice:
- Almost all servers run SSH services
- SSH port forwarding can securely expose internal ports
- SSH connections provide built-in encryption and authentication

---

## 2. Concept

**SSH tunnels map remote ports to local ports, making cross-machine agents appear as if they're running on the same machine.**

```
Your Machine                      Target Machine (target-machine)
┌──────────────────┐           ┌──────────────────────────┐
│ SSH -L 18445     │           │ agent-alpha :18445       │
│ SSH -L 18446     │── SSH ──►│ agent-beta  :18446       │
│ SSH -L 18447     │           │ agent-gamma :18447       │
│                  │           │ RegistryServer :8444     │
│ SSH -L 8444      │           │                          │
└──────────────────┘           └──────────────────────────┘
```

After mapping, from your machine's perspective:
```
localhost:18445  =  target-machine:18445 (agent-alpha)
localhost:18446  =  target-machine:18446 (agent-beta)
localhost:18447  =  target-machine:18447 (agent-gamma)
localhost:8444   =  target-machine:8444  (RegistryServer)
```

Your BridgeAgent configures `registryHost: "127.0.0.1"`, and all agents communicate as if local.

---

## 3. Manual SSH Tunnel Setup

### 3.1 Scenario 1: Target Machine Runs All Agents + Registry

```bash
# Single SSH command, pull all ports from target machine to local
ssh -L 8444:localhost:8444 \
     -L 18445:localhost:18445 \
     -L 18446:localhost:18446 \
     -L 18447:localhost:18447 \
     user@target-machine -N
```

If SSH port isn't 22:

```bash
ssh -L 8444:localhost:8444 \
     -L 18445:localhost:18445 \
     -L 18446:localhost:18446 \
     -L 18447:localhost:18447 \
     -p 2222 user@target-machine -N
```

`-N` means no remote command execution, port forwarding only.

### 3.2 Scenario 2: Your Machine Also Joins the Mesh

```bash
# Pull remote ports and expose your local Bridge port to the target machine
ssh -L 8444:localhost:8444 \
     -L 18445:localhost:18445 \
     -L 18446:localhost:18446 \
     -R 18448:localhost:18448 \
     user@target-machine -N
```

`-R 18448:localhost:18448` means: port 18448 on the target machine forwards to your local 18448.

### 3.3 Scenario 3: Target Machine Only Has SSH Port Open

Even if the target machine's firewall only opens port 22, SSH tunnels can penetrate all needed ports:

```bash
ssh -L 8444:localhost:8444 -L 18445:localhost:18445 user@target-machine -N
```

SSH establishes tunnels at the application layer, unaffected by target machine firewall rules (as long as SSH can connect).

---

## 4. Complete Startup Flow

### 4.1 Start Registry (on Target Machine)

```bash
# Target machine terminal
node dist/index.js bridge 8444
```

### 4.2 Start agent-alpha (on Target Machine)

```bash
# Target machine terminal
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
$env:AGENTGATE_BRIDGE_PORT = "18445"
node dist/index.js start
```

### 4.3 Start agent-beta (on Target Machine)

```bash
# Another target machine terminal
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
$env:AGENTGATE_BRIDGE_PORT = "18446"
node dist/index.js start
```

### 4.4 Establish SSH Tunnel (on Your Machine)

```bash
# Your machine terminal — single SSH pulls all ports
ssh -L 8444:localhost:8444 -L 18445:localhost:18445 -L 18446:localhost:18446 user@target-machine -N
```

Keep this terminal running — don't close it.

### 4.5 Start Your Local Agent

```bash
# Your machine, another terminal
$env:AGENTGATE_DEFAULT_AGENT = "agent-delta"
$env:AGENTGATE_BRIDGE_PORT = "18448"
$env:AGENTGATE_REGISTRY_HOST = "127.0.0.1"    # ← Accessing target machine's registry via SSH tunnel
node dist/index.js start
```

### 4.6 Verification

Check agent-delta's startup log — should see:

```
[Bridge] Connected to registry at 127.0.0.1:8444
[Bridge] Registered: agent-delta
[Bridge] Peer joined: agent-alpha (127.0.0.1:18445)
[Bridge] Peer joined: agent-beta (127.0.0.1:18446)
```

All four agents are under the same Registry, with P2P direct connections routed through the SSH tunnel.

---

## 5. Tunnel Type Reference

| SSH Parameter | Direction | Description |
|---------------|-----------|-------------|
| `-L 18445:localhost:18445` | Pull | Target `:18445` → Local `:18445` |
| `-R 18448:localhost:18448` | Expose | Local `:18448` → Target `:18448` |
| `-D 1080` | SOCKS | Not recommended, port-level forwarding is more precise |

Multiple `-L` / `-R` flags can be combined in a single SSH connection for multiple forwards.

---

## 6. Reconnection After Disconnect

All port mappings become invalid when the SSH tunnel disconnects. Use `autossh` (Linux/Mac) for automatic reconnection:

```bash
# Linux/Mac: autossh auto-reconnect
autossh -M 0 -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" \
  -L 8444:localhost:8444 -L 18445:localhost:18445 user@target-machine -N
```

Windows can use `ssh` with a batch loop:

```batch
:loop
ssh -L 8444:localhost:8444 -L 18445:localhost:18445 user@target-machine -N
timeout /t 5
goto loop
```

---

## 7. Security Considerations

| Risk | Mitigation |
|------|-----------|
| Jump host compromised | Bind `-L` to `127.0.0.1`, don't expose externally |
| Unauthorized agent joining | Bridge protocol will add register_token authentication later |
| SSH key leaked | Use dedicated deploy key, allow port forwarding only |
| Man-in-the-middle attack | SSH encrypts traffic, jump host can't decrypt tunnel content |

Recommended to fix tunnel parameters in `~/.ssh/config`:

```
Host target-machine
  HostName target-machine.example.com
  User ubuntu
  Port 22
  IdentityFile ~/.ssh/deploy_key
  LocalForward 8444 127.0.0.1:8444
  LocalForward 18445 127.0.0.1:18445
  LocalForward 18446 127.0.0.1:18446
  ExitOnForwardFailure yes
  ServerAliveInterval 30
```

Then just `ssh target-machine -N`.
