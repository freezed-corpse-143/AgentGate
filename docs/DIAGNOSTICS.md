# AgentGate Layered Diagnostic Manual

> Systematic layer-by-layer troubleshooting, from shallow to deep.
> Designed for "plugin doesn't work", "can't receive messages", "Bridge won't connect" scenarios.

---

## Layer Overview

```
Layer 0 — Environment Readiness
Layer 1 — Single Instance Startup
Layer 2 — Dual Instance Registration
Layer 3 — Bridge P2P Connectivity
Layer 4 — Message Delivery
Layer 5 — MCP Notification
```

Each layer has **diagnostic commands** and **expected output** to quickly pinpoint issues.

---

## Layer 0 — Environment Readiness

### 0.1 Build

```bash
npm run build
# Equivalent to: npx tsc
```

Expected output: No errors, exit code 0.

Verify build artifacts:

```bash
dir dist\mcp_server.js
```

Expected: File exists, size ~12KB.

### 0.2 Clean Up Residual Processes

Old session node processes may still occupy the registry port `:8444`, causing new instances to connect to a stale registry.

**Check port usage:**

```bash
netstat -ano | findstr ":8444 "
```

Expected output explanation:

| State | Meaning |
|-------|---------|
| `LISTENING` | A process is listening on 8444 (could be current session or residual) |
| `ESTABLISHED` | A client is connected to this port |
| `TIME_WAIT` | Recently disconnected, harmless |
| (no output) | Port free — first instance will self-bootstrap as registry |

**Check if it's a residual process:**

1. Note the `LISTENING` line's PID
2. Compare with the current session's process PIDs
3. If not matching, it's residual

**Clean up residuals:**

```powershell
# Kill known residual PIDs
taskkill /F /PID <PID1> /PID <PID2>
```

### 0.3 Clean agent_id Cache

The `~/.agentgate/agent_id` file overrides all ID settings except the `--agent-id` CLI parameter.

```bash
type "%USERPROFILE%\.agentgate\agent_id"
```

If the content doesn't match, delete it:

```bash
del /F "%USERPROFILE%\.agentgate\agent_id"
```

### 0.4 Check .mcp.json

```bash
type .mcp.json
```

Expected:

```json
{
  "mcpServers": {
    "agentgate": {
      "command": "node",
      "args": [
        "${CLAUDE_PLUGIN_ROOT}/dist/mcp_server.js"
      ]
    }
  }
}
```

---

## Layer 1 — Single Instance Startup

Verify the MCP Server loads and starts correctly.

### 1.1 Quick Load Test

```bash
node -e "import('./dist/mcp_server.js').then(()=>console.log('MODULE_LOAD_OK')).catch(e=>console.log('LOAD_FAIL:',e.message))"
```

Expected output:

```
[AgentRegistry] Registered: agent-alpha (Default Agent)
[AgentRuntime] Started — listening on agent.*.inbound (agents: [agent-alpha])
[Bridge] Listening on 127.0.0.1:53422
[Bridge] Self-bootstrapped as registry on :8444
[Bridge] Agent "agent-alpha" listening on :53422
[AgentGate MCP] Starting...
[AgentGate MCP] Running
MODULE_LOAD_OK
```

**Key checkpoints:**

| Output Fragment | Meaning |
|-----------------|---------|
| `Registered: <name>` | Agent registered successfully |
| `Self-bootstrapped as registry` | First instance, self-bootstrapped as registry |
| `Connected to registry` | Subsequent instance, connected to existing registry |
| `[AgentGate MCP] Running` | MCP Server ready, waiting for stdin |

### 1.2 Foreground Startup (Debugging)

```bash
node dist/mcp_server.js --agent-id agent-alpha
```

Press `Ctrl+C` to exit. stderr output matches section 1.1.

---

## Layer 2 — Dual Instance Registration

Verify two agents can register with the same registry.

### 2.1 Start agent-alpha (Registry)

```bash
# Terminal / background
node dist/mcp_server.js --agent-id agent-alpha
```

Expected output includes:

```
[Bridge] Self-bootstrapped as registry on :8444
```

### 2.2 Start agent-beta (Client)

```bash
node dist/mcp_server.js --agent-id agent-beta
```

Expected output includes:

```
[Bridge] Connected to registry at 127.0.0.1:8444
```

### 2.3 Verify Registry Peer List

Query the current registered peers with a probe script:

```bash
node -e "
const n=require('net');
const s=new n.Socket();
const buf=[];
s.on('data',d=>buf.push(d.toString()));
s.connect(8444,'127.0.0.1',()=>{
  s.write(JSON.stringify({type:'register',agent_id:'probe',host:'127.0.0.1',port:0,ts:new Date().toISOString()})+'\n');
  setTimeout(()=>{
    const lines=buf.join('').split('\n').filter(Boolean);
    for(const l of lines) console.log('PEER:',l.slice(0,300));
    s.destroy();
    process.exit(0);
  },1000);
});
s.on('error',e=>{console.log('ERR:',e.message);process.exit(1)});
"
```

Expected output:

```
PEER: {"type":"register_ack","agent_id":"probe","peers":[
  {"agent_id":"agent-alpha","host":"127.0.0.1","port":<port>,"seen_at":"..."},
  {"agent_id":"agent-beta","host":"127.0.0.1","port":<port>,"seen_at":"..."}
]}
```

**Both peers must appear.** If only one:

- Check Layer 0 — the other process may have connected to a stale registry
- Check Layer 1 — the other instance may have failed to start

---

## Layer 3 — Bridge P2P Connectivity

Verify direct agent-to-agent communication.

### 3.1 Registry Confirmation

Layer 2's peer list includes both agents — proceed to the next step.

### 3.2 Send Test Message

```bash
node -e "
const n=require('net');
const s=new n.Socket();
const buf=[];
s.on('data',d=>buf.push(d.toString()));
s.connect(8444,'127.0.0.1',()=>{
  s.write(JSON.stringify({type:'register',agent_id:'test-harness',host:'127.0.0.1',port:0,ts:new Date().toISOString()})+'\n');
  setTimeout(()=>{
    const lines=buf.join('').split('\n').filter(Boolean);
    const ack=JSON.parse(lines[0]);
    const beta=ack.peers.find(p=>p.agent_id==='agent-beta');
    if(!beta){console.log('FAIL: agent-beta not in registry');s.destroy();process.exit(1);}
    const p=new n.Socket();
    p.connect(beta.port,beta.host,()=>{
      p.write(JSON.stringify({type:'message',topic:'agent.agent-beta.inbound',
        envelope:{message_id:'test_'+Date.now().toString(36),
          trace_id:'trace_test_'+Date.now().toString(36),
          channel:'test',channel_user_id:'tester',
          agent_id:'agent-beta',
          conversation_id:'conv_test_'+Date.now().toString(36),
          direction:'inbound',type:'text',
          payload:{text:'Hello from diagnostics!'},
          timestamp:new Date().toISOString()}})+'\n');
      console.log('OK: message sent to agent-beta');
      setTimeout(()=>{p.destroy();s.destroy();process.exit(0);},500);
    });
  },1000);
});
s.on('error',e=>{console.log('FAIL:',e.message);process.exit(1)});
"
```

Expected output:

```
OK: message sent to agent-beta
```

### 3.3 Verify Receiver

Check agent-beta's stderr output:

Expected output should contain:

```
[AgentRuntime] No route for: test_<id>
```

and

```json
{"method":"notifications/claude/channel","params":{...}}
```

**Key checkpoints:**

| Output | Meaning |
|--------|---------|
| `[AgentRuntime] No route for` | ✅ Message reached local bus, no channel handler (expected for test messages) |
| `notifications/claude/channel` | ✅ MCP Server generated channel notification |
| Neither present | ❌ Message didn't arrive — Bridge routing may be broken |

---

## Layer 4 — End-to-End Message Delivery

Verify the complete MCP tool invocation chain.

### 4.1 Prerequisites

Layers 1-3 all pass. Both MCP Server instances are running.

### 4.2 Simulate MCP Call

MCP Server receives JSON-RPC via `stdin` and returns responses via `stdout`.
Simulate `list_conversations` call:

```bash
echo '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"list_conversations","arguments":{}}}' | node dist/mcp_server.js --agent-id agent-alpha 2>/dev/null
```

Expected output (stdout):

```json
{"jsonrpc":"2.0","id":"1","result":{"content":[{"type":"text","text":"(no conversations)"}]}}
```

### 4.3 Cross-Instance send_message Test

This is the most complete end-to-end test, requiring both instances running.

**Test approach:** Leverage agent-beta's `pendingMessages` mechanism — any message sent to `agent.agent-beta.inbound` enters the pending queue and is returned on the next tool call.

Execute test (send a message to agent-beta from outside, verify MCP tools can read it):

```bash
# 1. Send message to agent-beta via Bridge
node -e "
const n=require('net');
const s=new n.Socket();
const buf=[];
s.on('data',d=>buf.push(d.toString()));
s.connect(8444,'127.0.0.1',()=>{
  s.write(JSON.stringify({type:'register',agent_id:'ext-sender',host:'127.0.0.1',port:0,ts:new Date().toISOString()})+'\n');
  setTimeout(()=>{
    const lines=buf.join('').split('\n').filter(Boolean);
    const ack=JSON.parse(lines[0]);
    const beta=ack.peers.find(p=>p.agent_id==='agent-beta');
    if(!beta){console.log('FAIL: beta not found');process.exit(1);}
    const p=new n.Socket();
    p.connect(beta.port,beta.host,()=>{
      const convId='e2e_'+Date.now().toString(36);
      p.write(JSON.stringify({type:'message',topic:'agent.agent-beta.inbound',
        envelope:{message_id:convId+'_msg',trace_id:convId+'_trace',
          channel:'agentgate',channel_user_id:'agent-alpha',
          agent_id:'agent-beta',conversation_id:convId,
          direction:'inbound',type:'text',
          payload:{text:'E2E test message'},
          timestamp:new Date().toISOString()}})+'\n');
      console.log('OK: sent to beta, conv='+convId);
      setTimeout(()=>process.exit(0),1000);
    });
  },1000);
});
" 2>&1

# 2. Check agent-beta's job_output to confirm receipt
# 3. Verify conversation store has the record
```

---

## Layer 5 — MCP Notification

Verify whether `notifications/claude/channel` can be consumed by Claude.

> ⚠️ This layer requires Claude Code desktop interaction and cannot be fully verified in headless mode.
> However, MCP Server stderr prints the notification JSON, confirming correct formatting.

### 5.1 Check Notification Format

After agent-beta receives a message, its stderr should output:

```json
{
  "method": "notifications/claude/channel",
  "params": {
    "content": "...",
    "meta": {
      "chat_id": "...",
      "message_id": "...",
      "user": "...",
      "user_id": "...",
      "agent_id": "agent-beta",
      "conversation_id": "...",
      "source": "...",
      "ts": "..."
    }
  }
}
```

### 5.2 Known Issues

| Symptom | Cause |
|---------|-------|
| Notification sent but Claude doesn't display `<channel>` | May be limited to marketplace-installed plugins. `--dangerously-load-development-channels` may bypass |
| Claude responds "no agentgate tools" | `.mcp.json` path incorrect, or MCP Server startup error |

---

## Common Issues Quick Reference

| Symptom | Possible Cause | Check Layer |
|---------|---------------|-------------|
| MCP Server starts silently | tsc not built / missing dependencies | Layer 0 |
| "Self-bootstrapped as registry" doesn't appear | Port 8444 occupied by residual process | Layer 0.2 |
| Agent ID always "default" | `~/.agentgate/agent_id` file interference | Layer 0.3 |
| Registry only has 1 peer | Second instance not connected / connected to stale registry | Layer 2 |
| Message sent successfully but no response | `pendingMessages` queue requires next tool call to flush | Layer 4 |
| Bridge connects then immediately disconnects | Heartbeat timeout (60s) — check network latency | Layer 3 |
| Notification sent but Claude doesn't display | Version restriction — try `--dangerously-load-development-channels` | Layer 5 |

---

## Layered Troubleshooting Flow

```
┌──────────────────────────────┐
│ Layer 0: Environment Ready   │  ← Start here
│  npm run build succeeds       │
│  netstat :8444 no residuals   │
│  agent_id file is correct     │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│ Layer 1: Single Instance     │
│  node -e import no errors    │
│  [AgentGate MCP] Running     │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│ Layer 2: Dual Registration   │
│  alpha: Self-bootstrapped    │
│  beta: Connected to registry │
│  probe sees 2 peers          │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│ Layer 3: Bridge P2P Connect  │
│  Sender: OK message sent     │
│  Receiver: channel notificat.│
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│ Layer 4: End-to-End Delivery │
│  MCP tools/call works        │
│  conversation store has rec. │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│ Layer 5: Claude Display      │  Requires GUI
│  <channel> block appears      │
└──────────────────────────────┘
```

Proceed to the next layer only after passing the current one. If a layer fails, don't continue to higher layers.

---

## Diagnostic Command Cheat Sheet

| Purpose | Command |
|---------|---------|
| Build | `npm run build` |
| Check port | `netstat -ano \| findstr ":8444 "` |
| Kill residual | `taskkill /F /PID <PID>` |
| Start alpha | `node dist/mcp_server.js --agent-id agent-alpha` |
| Start beta | `node dist/mcp_server.js --agent-id agent-beta` |
| Query peer list | See Layer 2.3 probe script |
| Send test message | See Layer 3.2 script |
| Simulate MCP call | `echo '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"list_conversations","arguments":{}}}' \| node dist/mcp_server.js --agent-id agent-alpha 2>/dev/null` |

---

## Common Fix Records

### Fix 1: `reply` Cross-Instance Routing Failure

**Symptom:** `send_message` succeeds, `<channel>` block appears, but `reply` doesn't reach the other side. MCP Server stderr shows `[AgentRuntime] No route for: <msg_id>`.

**Root cause:** In `src/mcp_server.ts`'s `reply` handler:
1. `agent_id` defaulted to the current agent (self), causing `routeToPeer` to skip when target=self
2. Messages published to `agent.*.outbound`, Bridge doesn't forward outbound messages for target=self

**Fix (2026-06-03):**
```typescript
// Old: defaulted to self → Bridge skipped
agent_id: targetAgent ?? config.server.defaultAgent

// New: infer sender from original message
const senderId = original?.channel_user_id || original?.agent_id
const replyTarget = (args.target_agent_id as string | undefined) || senderId
agent_id: replyTarget ?? config.server.defaultAgent

// Old: outbound → Bridge doesn't forward
bus.publish(`agent.${response.agent_id}.outbound`, response)

// New: inbound → Bridge routes to target peer
bus.publish(`agent.${replyTarget}.inbound`, response)
```

**Verification:** Start alpha + beta instances, send a cross-instance message via Bridge TCP, check for `notifications/claude/channel` on the receiving side.
