# AgentGate Debug 指南

> 双 Claude 通信调试手册 — 常见问题、诊断工具、协议分析

---

## 一、启动检查清单

### 1.1 前置条件

```
□ Node.js 24+ 已安装
□ npm run build 成功（node_modules\.bin\tsc.cmd）
□ dist → agentgate-plugin/dist/ 已同步
□ agentgate-plugin/node_modules/ 已安装
□ ~/.claude.json 已配置 mcpServers.agentgate（含 --agent-id ${AGENTGATE_DEFAULT_AGENT}）
□ ~/.claude.json 包含 tengu_harbor: true
```

### 1.2 启动命令

```powershell
# 终端 A — agent-alpha
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
claude --dangerously-load-development-channels server:agentgate

# 终端 B — agent-beta
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
claude --dangerously-load-development-channels server:agentgate
```

> `~/.claude.json` 中必须已配置 `mcpServers.agentgate`，args 中包含 `--agent-id ${AGENTGATE_DEFAULT_AGENT}`。
> 第一个启动的实例自动成为注册中心（:8444），后续实例自动发现并建立 P2P 直连。

### 1.3 验证 MCP Server 启动

在 Claude 中输入任意内容，观察工具调用是否正常。MCP Server 的 stderr 输出被 Claude 捕获，不会显示在终端中。

要直接测试 MCP Server 是否正常：

```bash
# 模拟 Claude 启动 MCP Server（不带 Claude）
node dist/mcp_server.js
# 预期输出（无 AGENTGATE_BRIDGE_ENABLED=false 时）：
#   [AgentRegistry] Registered: default (Default Agent)
#   [AgentRuntime] Started — agent.*.inbound (agents: [default])
#   [BridgeServer] Listening on 0.0.0.0:8444
#   [AgentGate MCP] Bridge hub on :8444
#   [BridgeClient] Connected to 127.0.0.1:8444
#   [AgentGate MCP] Starting...
#   [AgentGate MCP] Running
```

---

## 二、常见问题

### 2.1 MCP 工具不可见

```
症状: Claude 说"没有找到 agentgate 工具"
```

**可能原因**:

| 原因 | 检查方法 | 解决 |
|------|---------|------|
| 插件目录不存在 | `dir agentgate-plugin` | 确认路径正确 |
| 缺少 node_modules | `dir agentgate-plugin\node_modules` | `npm install --prefix agentgate-plugin` |
| 缺少 dist | `dir agentgate-plugin\dist\mcp_server.js` | `npm run build && Copy-Item -Recurse -Force dist/* agentgate-plugin/dist/` |
| MCP Server 启动报错 | 直接运行 `node agentgate-plugin/dist/mcp_server.js` 看报错 | 修复报错 |

### 2.2 Bridge 无法连接

```
症状: 两个 Claude 各自能调用工具，但消息互相收不到
```

**诊断步骤**:

```bash
# 1. 检查端口占用
netstat -ano | findstr :8444
# 应有 LISTENING 状态，PID 对应某个 node 进程

# 2. 检查 node 进程
Get-Process -Name node | Where-Object { $_.CommandLine -match 'mcp_server' }

# 3. 直接测试 bridge 连通性
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

如果 bridge 未启动（端口未监听），检查 MCP Server 是否正常启动。

### 2.3 send_message 发送成功但对端收不到

```
症状: Claude A 显示"消息已发送"，但 Claude B 看不到
```

**检查链路**:

```
Claude A → send_message handler → bus.publish(agent.agent-beta.inbound)
  → BridgeClient A → TCP → BridgeServer
    → BridgeClient B → bus.publish(agent.agent-beta.inbound)
      → MCP Server B subscriber → agent_id 检查
        → conversationStore.appendMessage
        → pendingMessages.push
        → mcp.notification (可能不工作)
```

**诊断**:

```bash
# 1. 验证 message 确实写入了 conversation store
Get-ChildItem $env:USERPROFILE\.agentgate\conversations\ | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name

# 2. 检查文件内容
Get-Content $env:USERPROFILE\.agentgate\conversations\conv_xxx.json | ConvertFrom-Json | Select-Object agent_id, text

# 3. 在 Claude B 中运行
"列出最近的对话"
```

### 2.4 `AGENTGATE_DEFAULT_AGENT` 使用的是 `default`

```
症状: conversation store 中所有消息的 agent_id 都是 "default"
```

**原因**: Claude 不将终端环境变量传给 MCP 子进程。

**检查**:

```bash
# 查看 MCP Server 读取的 agent_id
Get-Content $env:USERPROFILE\.agentgate\agent_id
```

**修复**:

```bash
echo agent-alpha > $env:USERPROFILE\.agentgate\agent_id
# 必须重新启动 Claude
```

### 2.5 端口 8444 被占用

```
症状: MCP Server 启动日志显示 "Bridge peer on :8444"
      而不是 "Bridge hub on :8444"
```

**检查**:

```bash
netstat -ano | findstr :8444
# 如果 PID 不是当前 Claude 的 MCP Server 进程
# 说明有残留进程

# 杀死占用进程（根据实际的 PID）
Stop-Process -Id <PID> -Force
```

### 2.6 conversation store 文件冲突

```
症状: list_conversations 返回了不属于当前 agent 的对话
```

**原因**: 所有 Claude 实例共享 `~/.agentgate/conversations/` 目录。

**解决**: 测试前清理：

```bash
Remove-Item -Recurse -Force $env:USERPROFILE\.agentgate\conversations\
```

### 2.7 MCP Server 启动失败（静默）

```
症状: Claude 显示 "MCP servers failed" 且工具列表为空
```

**诊断**:

```bash
# 模拟 Claude 启动 MCP Server
node agentgate-plugin/dist/mcp_server.js 2>&1

# 如果输出中不包含 "[AgentGate MCP] Running"
# 说明启动过程有错误
```

**常见错误**:

| 错误 | 原因 | 解决 |
|------|------|------|
| `Cannot find module 'ssh2'` | 插件目录缺少 node_modules | `npm install --prefix agentgate-plugin` |
| `import { Server as SshServer }` 语法错 | ssh2 的 CommonJS 兼容问题 | 确认使用 `import ssh2 from 'ssh2'` 模式 |
| `ERR_SOCKET_BAD_PORT` | commander.js parseInt radix 问题 | 确认 CLI 使用 `(v) => parseInt(v, 10)` |

---

## 三、诊断工具

### 3.1 快速诊断脚本

```javascript
// tests/diagnose_bridge.mjs
// 启动两个 MCP Server，通过 bridge 发送消息并验证链路
// 用法: node tests/diagnose_bridge.mjs

node tests/diagnose_bridge.mjs
# 输出包含:
#   [HIT] [AgentGate MCP] Channel message from agent-alpha: ...
#   说明消息成功经过 bridge 到达对端
```

### 3.2 Bridge 探针

```javascript
// tests/probe.mjs
// 连接 bridge 并监控消息
node tests/probe.mjs
```

### 3.3 Agent ID 验证

```bash
# 验证 MCP Server 读取到正确的 agent_id
node -e "
const fs = require('fs');
const p = require('path');
const f = p.join(process.env.USERPROFILE, '.agentgate', 'agent_id');
console.log('agent_id:', fs.readFileSync(f, 'utf8').trim());
"
```

### 3.4 端口清理

```powershell
# 杀死所有 MCP Server 进程（保留当前会话）
Get-Process -Name node | Where-Object { $_.CommandLine -match 'mcp_server' } | Stop-Process -Force
```

---

## 四、MCP 协议调试

### 4.1 notification 格式

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/claude/channel",
  "params": {
    "content": "消息文本",
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

### 4.2 MCP SDK 调用链路

```
Server.notification({ method, params })
  → Protocol.notification()
    → 检查 this._transport 是否存在
    → assertNotificationCapability(method)
      → switch(method):
          'notifications/message'           → 需要 logging capability
          'notifications/resources/*'       → 需要 resources capability
          'notifications/tools/*'           → 需要 tools capability
          'notifications/prompts/*'         → 需要 prompts capability
          'notifications/cancelled'         → 始终允许
          'notifications/progress'          → 始终允许
          'notifications/claude/channel'    → 不在 switch 中 → 放行 ✅
    → transport.send(jsonRpcMessage)
      → StdioServerTransport.send()
        → process.stdout.write(JSON.stringify(message))
```

### 4.3 tool 调用格式

向 `agent.agent-beta.inbound` 发送的 Envelope：

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
  "payload": { "text": "你好" },
  "timestamp": "2026-06-03T04:48:02.698Z"
}
```

---

## 五、环境检查

### 5.1 关键文件

```
~/.claude.json
  → mcpServers.agentgate: { command: "node", args: ["...mcp_server.js", "--agent-id", "${AGENTGATE_DEFAULT_AGENT}"] }
  → cachedGrowthBookFeatures.tengu_harbor: true

~/.agentgate/agent_id
  → 内容: agent-alpha 或 agent-beta

~/.agentgate/conversations/
  → JSON 文件，每个对话一个文件

C:\Projects\AgentGate\agentgate-plugin\.mcp.json
  → 指向 dist/mcp_server.js
```

### 5.2 关键环境变量

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `AGENTGATE_DEFAULT_AGENT` | Agent ID（已废弃，改用文件） | `default` |
| `AGENTGATE_BRIDGE_PORT` | Bridge 端口 | `8444` |
| `AGENTGATE_BRIDGE_HOST` | 远程 Bridge 地址 | `localhost` |
| `AGENTGATE_BRIDGE_ENABLED` | 禁用 bridge（设为 false/0） | 自动启用 |
| `AGENTGATE_DIR` | 状态目录 | `~/.agentgate` |

---

## 六、已知问题

| 问题 | 状态 | 说明 |
|------|------|------|
| notifications/claude/channel 不工作 | ⚠️ 未解决 | MCP SDK 已发送，但 Claude 不显示。可能限制 marketplace 插件 |
| env 变量不传 MCP 子进程 | ✅ 已解决 | 改用文件读取 agent_id |
| Telegram 同名通知格式完全一致却工作 | ❓ 原因不明 | 可能是 marketplace 安装与 --plugin-dir 差异 |
| unbuned 提取的 JS 严重混淆 | ✅ 已确认 | 15MB minified，变量名单字母，无法定位具体逻辑 |
| commander.js parseInt radix 问题 | ✅ 已修复 | 使用 `(v) => parseInt(v, 10)` |

---

## 七、恢复出厂设置

彻底清理测试状态：

```powershell
# 1. 杀死所有 Claude
taskkill /f /im claude.exe

# 2. 杀死所有 MCP Server
Get-Process -Name node | Where-Object { $_.CommandLine -match 'mcp_server' } | Stop-Process -Force

# 3. 清理状态
Remove-Item -Recurse -Force $env:USERPROFILE\.agentgate\ -ErrorAction SilentlyContinue

# 4. 重新构建
cd C:\Projects\AgentGate
npm run build
Copy-Item -Recurse -Force dist/* agentgate-plugin/dist/

# 5. 设置 agent_id
echo agent-alpha > $env:USERPROFILE\.agentgate\agent_id

# 6. 启动 Claude
claude --plugin-dir C:\Projects\AgentGate\agentgate-plugin
```
