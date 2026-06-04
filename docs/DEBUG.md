# AgentGate Debug Guide

> Dual Claude communication debugging manual — common issues, diagnostic tools, protocol analysis

---

## 1. Startup Checklist

### 1.1 Prerequisites

```
□ Node.js 24+ installed
□ npm run build succeeded (node_modules\.bin\tsc.cmd)
□ node_modules/ installed
□ ~/.claude.json configured with mcpServers.agentgate (with --agent-id ${AGENTGATE_DEFAULT_AGENT})
□ ~/.claude.json includes tengu_harbor: true
```

### 1.2 Startup Commands

```powershell
# Terminal A — agent-alpha
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
claude --dangerously-load-development-channels server:agentgate

# Terminal B — agent-beta
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
claude --dangerously-load-development-channels server:agentgate
```

> `~/.claude.json` must have `mcpServers.agentgate` configured, args including `--agent-id ${AGENTGATE_DEFAULT_AGENT}`.
> The first instance automatically becomes the registry (:8444), subsequent instances auto-discover and establish P2P connections.

### 1.3 Verify MCP Server Startup

Type anything in Claude and observe if tools work correctly. MCP Server's stderr output is captured by Claude and not shown in the terminal.

To test MCP Server directly:

```bash
# Simulate Claude starting MCP Server (without Claude)
node dist/mcp_server.js
# Expected output (without AGENTGATE_BRIDGE_ENABLED=false):
#   [AgentRegistry] Registered: default (Default Agent)
#   [AgentRuntime] Started — agent.*.inbound (agents: [default])
#   [BridgeServer] Listening on 0.0.0.0:8444
#   [AgentGate MCP] Bridge hub on :8444
#   [BridgeClient] Connected to 127.0.0.1:8444
#   [AgentGate MCP] Starting...
#   [AgentGate MCP] Running
```

---

## 2. Common Issues

### 2.1 MCP Tools Not Visible

```
Symptom: Claude says "no agentgate tools found"
```

**Possible causes:**

| Cause | Check Method | Solution |
|-------|-------------|----------|
| dist doesn't exist | `dir dist\mcp_server.js` | Make sure project is built |
| Missing node_modules | `dir node_modules` | `npm install` |
| MCP Server startup error | Run `node dist/mcp_server.js` directly to see errors | Fix the error |

### 2.2 Bridge Can't Connect

```
Symptom: Both Claude instances can use tools, but messages don't reach each other
```

**Diagnostic steps:**

```bash
# 1. Check port usage
netstat -ano | findstr :8444
# Should show LISTENING state, PID matches a node process

# 2. Check node processes
Get-Process -Name node | Where-Object { $_.CommandLine -match 'mcp_server' }

# 3. Direct bridge connectivity test
node -e "
const net = require('net');
const s = new net.Socket();
s.connect(8444, '127.0.0.1', () => {
  s.write(JSON.stringify({type:'hello',node_id:'test'}) + '\n');
  console.log('CONNECTED');
  setTimeout(() => process.exit(0), 500);
});
s.on('error', (e) => console.log('ERROR:', e.message));
"
```

If the bridge isn't started (port not listening), check if MCP Server started correctly.

### 2.3 send_message Succeeds but Receiver Can't See

```
Symptom: Claude A shows "message sent", but Claude B can't see it
```

**Check the chain:**

```
Claude A → send_message handler → bus.publish(agent.agent-beta.inbound)
  → BridgeClient A → TCP → BridgeServer
    → BridgeClient B → bus.publish(agent.agent-beta.inbound)
      → MCP Server B subscriber → agent_id check
        → conversationStore.appendMessage
        → pendingMessages.push
        → mcp.notification (may not work)
```

**Diagnosis:**

```bash
# 1. Verify message was written to conversation store
Get-ChildItem $env:USERPROFILE\.agentgate\conversations\ | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name

# 2. Check file content
Get-Content $env:USERPROFILE\.agentgate\conversations\conv_xxx.json | ConvertFrom-Json | Select-Object agent_id, text

# 3. In Claude B, run
"List recent conversations"
```

### 2.4 `AGENTGATE_DEFAULT_AGENT` Always Shows `default`

```
Symptom: All messages in conversation store show agent_id "default"
```

**Cause**: Claude does not pass terminal environment variables to MCP subprocesses.

**Check:**

```bash
# View the agent_id read by MCP Server
Get-Content $env:USERPROFILE\.agentgate\agent_id
```

**Fix:**

```bash
echo agent-alpha > $env:USERPROFILE\.agentgate\agent_id
# Must restart Claude
```

### 2.5 Port 8444 in Use

```
Symptom: MCP Server startup log shows "Bridge peer on :8444"
       instead of "Bridge hub on :8444"
```

**Check:**

```bash
netstat -ano | findstr :8444
# If PID is not the current Claude's MCP Server process
# there's a residual process

# Kill the occupying process (use actual PID)
Stop-Process -Id <PID> -Force
```

### 2.6 Conversation Store File Conflicts

```
Symptom: list_conversations shows conversations that don't belong to the current agent
```

**Cause**: All Claude instances share `~/.agentgate/conversations/` directory.

**Solution**: Clean before testing:

```bash
Remove-Item -Recurse -Force $env:USERPROFILE\.agentgate\conversations\
```

### 2.7 MCP Server Silent Startup Failure

```
Symptom: Claude shows "MCP servers failed" and tool list is empty
```

**Diagnosis:**

```bash
# Simulate Claude starting MCP Server
node dist/mcp_server.js 2>&1

# If output doesn't include "[AgentGate MCP] Running"
# there's a startup error
```

**Common errors:**

| Error | Cause | Solution |
|-------|-------|----------|
| `Cannot find module 'ssh2'` | Missing node_modules | `npm install` |
| `ERR_SOCKET_BAD_PORT` | commander.js parseInt radix issue | Use `(v) => parseInt(v, 10)` |

---

## 3. Diagnostic Tools

### 3.1 Quick Diagnostic Script

```javascript
// tests/diagnose_bridge.mjs
// Starts two MCP Servers, sends a message via bridge, and verifies the chain
// Usage: node tests/diagnose_bridge.mjs

node tests/diagnose_bridge.mjs
# Output includes:
#   [HIT] [AgentGate MCP] Channel message from agent-alpha: ...
#   Confirms message successfully reached the other side via bridge
```

### 3.2 Bridge Probe

```javascript
// tests/probe.mjs
// Connects to bridge and monitors messages
node tests/probe.mjs
```

### 3.3 Agent ID Verification

```bash
# Verify MCP Server reads the correct agent_id
node -e "
const fs = require('fs');
const p = require('path');
const f = p.join(process.env.USERPROFILE, '.agentgate', 'agent_id');
console.log('agent_id:', fs.readFileSync(f, 'utf8').trim());
"
```

### 3.4 Port Cleanup

```powershell
# Kill all MCP Server processes (preserves current session)
Get-Process -Name node | Where-Object { $_.CommandLine -match 'mcp_server' } | Stop-Process -Force
```

---

## 4. MCP Protocol Debugging

### 4.1 Notification Format

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/claude/channel",
  "params": {
    "content": "Message text",
    "meta": {
      "chat_id": "agent-alpha",
      "agent_id": "agent-beta",
      "conversation_id": "conv_xxx",
      "trace_id": "trace_xxx",
      "source": "agentgate",
      "ts": "2026-06-03T04:48:02.698Z"
    }
  }
}
```

### 4.2 MCP SDK Call Chain

```
Server.notification({ method, params })
  → Protocol.notification()
    → Check if this._transport exists
    → assertNotificationCapability(method)
      → switch(method):
          'notifications/message'           → requires logging capability
          'notifications/resources/*'       → requires resources capability
          'notifications/tools/*'           → requires tools capability
          'notifications/prompts/*'         → requires prompts capability
          'notifications/cancelled'         → always allowed
          'notifications/progress'          → always allowed
          'notifications/claude/channel'    → not in switch → passes through ✅
    → transport.send(jsonRpcMessage)
      → StdioServerTransport.send()
        → process.stdout.write(JSON.stringify(message))
```

### 4.3 Tool Call Format

Envelope sent to `agent.agent-beta.inbound`:

```json
{
  "message_id": "mcp_xxxxx",
  "trace_id": "trace_xxxxx",
  "channel": "agentgate",
  "channel_user_id": "agent-alpha",
  "agent_id": "agent-beta",
  "conversation_id": "conv_xxxxx",
  "direction": "inbound",
  "type": "text",
  "payload": { "text": "Hello" },
  "timestamp": "2026-06-03T04:48:02.698Z"
}
```

---

## 5. Environment Check

### 5.1 Key Files

```
~/.claude.json
  → mcpServers.agentgate: { command: "node", args: ["...mcp_server.js", "--agent-id", "${AGENTGATE_DEFAULT_AGENT}"] }
  → cachedGrowthBookFeatures.tengu_harbor: true

~/.agentgate/agent_id
  → content: agent-alpha or agent-beta

~/.agentgate/conversations/
  → JSON files, one per conversation

C:\Projects\AgentGate\.mcp.json
  → Points to dist/mcp_server.js
```

### 5.2 Key Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `AGENTGATE_DEFAULT_AGENT` | Agent ID (deprecated, use file) | `default` |
| `AGENTGATE_BRIDGE_PORT` | Bridge port | `8444` |
| `AGENTGATE_BRIDGE_HOST` | Remote Bridge address (for cross-machine) | `localhost` |
| `AGENTGATE_BRIDGE_ENABLED` | Disable bridge (set to false/0) | auto-enabled |
| `AGENTGATE_DIR` | State directory | `~/.agentgate` |

---

## 6. Known Issues

| Issue | Status | Notes |
|-------|--------|-------|
| notifications/claude/channel doesn't work | ⚠️ Unresolved | MCP SDK sends it, but Claude doesn't display. Possibly marketplace plugin limitation |
| Env vars not passed to MCP subprocess | ✅ Fixed | Changed to file-based agent_id reading |
| Telegram identical notification format works | ❓ Unknown cause | Possibly marketplace vs --plugin-dir difference |
| unbuned extracted JS heavily obfuscated | ✅ Confirmed | 15MB minified, single-letter variable names, can't locate specific logic |
| commander.js parseInt radix issue | ✅ Fixed | Using `(v) => parseInt(v, 10)` |

---

## 7. Factory Reset

Complete test state cleanup:

```powershell
# 1. Kill all Claude instances
taskkill /f /im claude.exe

# 2. Kill all MCP Server processes
Get-Process -Name node | Where-Object { $_.CommandLine -match 'mcp_server' } | Stop-Process -Force

# 3. Clean state
Remove-Item -Recurse -Force $env:USERPROFILE\.agentgate\ -ErrorAction SilentlyContinue

# 4. Rebuild
cd C:\Projects\AgentGate
npm run build

# 5. Set agent_id
echo agent-alpha > $env:USERPROFILE\.agentgate\agent_id

# 6. Start Claude
claude --dangerously-load-development-channels server:agentgate
```
