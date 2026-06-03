# AgentGate 分层诊断手册

> 从浅到深逐层排查，每一层通过后再进入下一层。
> 适合"插件不工作"、"收不到消息"、"Bridge 连不上"等场景。

---

## 层级概览

```
Layer 0 — 环境就绪
Layer 1 — 单实例启动
Layer 2 — 双实例注册
Layer 3 — Bridge P2P 连通
Layer 4 — 消息投递
Layer 5 — MCP Notification
```

每一层都有**诊断命令**和**预期输出**，对照即可定位问题。

---

## Layer 0 — 环境就绪

### 0.1 构建

```bash
npm run build
# 等价于: npx tsc
```

预期输出：无报错，exit code 0。

验证产物：

```bash
dir dist\mcp_server.js
```

预期：文件存在，大小 ~12KB。

### 0.2 清理残留进程

旧 session 残留的 node 进程可能仍占用注册中心端口 `:8444`，导致新实例连接的是老旧注册中心。

**检查端口占用：**

```bash
netstat -ano | findstr ":8444 "
```

预期输出列说明：

| 状态 | 含义 |
|------|------|
| `LISTENING` | 有进程在监听 8444（可能是本 session 也可能是残留） |
| `ESTABLISHED` | 有客户端连接到此端口 |
| `TIME_WAIT` | 刚断开的连接，无害 |
| (无输出) | 端口空闲 — 首个实例会自举为注册中心 |

**判断是否为残留进程：**

1. 记下 `LISTENING` 行的 PID
2. 与当前 session 启动的进程对比（已知 PID 来自 `run_background` 返回值）
3. 若不匹配则为残留

**清理残留：**

```powershell
# 杀死已知残留 PID
taskkill /F /PID <PID1> /PID <PID2>
```

### 0.3 清理 agent_id 缓存

`~/.agentgate/agent_id` 文件会覆盖 `--agent-id` CLI 参数以外的所有 ID 设置。

```bash
type "%USERPROFILE%\.agentgate\agent_id"
```

如果内容不是预期的，删除它：

```bash
del /F "%USERPROFILE%\.agentgate\agent_id"
```

### 0.4 检查 .mcp.json

```bash
type .mcp.json
```

预期：

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

## Layer 1 — 单实例启动

验证 MCP Server 能正常加载并启动。

### 1.1 快速加载测试

```bash
node -e "import('./dist/mcp_server.js').then(()=>console.log('MODULE_LOAD_OK')).catch(e=>console.log('LOAD_FAIL:',e.message))"
```

预期输出：

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

**关键检查点：**

| 输出片段 | 含义 |
|----------|------|
| `Registered: <name>` | Agent 注册成功 |
| `Self-bootstrapped as registry` | 首个实例，自举为注册中心 |
| `Connected to registry` | 后续实例，连接到已有注册中心 |
| `[AgentGate MCP] Running` | MCP Server 就绪，等待 stdin |

### 1.2 前台启动（调试用）

```bash
node dist/mcp_server.js --agent-id agent-alpha
```

按 `Ctrl+C` 退出。stderr 输出与 1.1 相同。

---

## Layer 2 — 双实例注册

验证两个 Agent 能注册到同一注册中心。

### 2.1 启动 agent-alpha（注册中心）

```bash
# 终端 / 后台
node dist/mcp_server.js --agent-id agent-alpha
```

预期输出包含：

```
[Bridge] Self-bootstrapped as registry on :8444
```

### 2.2 启动 agent-beta（客户端）

```bash
node dist/mcp_server.js --agent-id agent-beta
```

预期输出包含：

```
[Bridge] Connected to registry at 127.0.0.1:8444
```

### 2.3 验证注册中心列表

用测试探测脚本查询当前注册的 peers：

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

预期输出：

```
PEER: {"type":"register_ack","agent_id":"probe","peers":[
  {"agent_id":"agent-alpha","host":"127.0.0.1","port":<port>,"seen_at":"..."},
  {"agent_id":"agent-beta","host":"127.0.0.1","port":<port>,"seen_at":"..."}
]}
```

**两个 peer 都必须出现。** 若只有一个：

- 检查 Layer 0 — 可能另一个进程连接到了残留注册中心
- 检查 Layer 1 — 另一个实例是否启动失败

---

## Layer 3 — Bridge P2P 连通

验证 agent 间能直连通信。

### 3.1 注册中心确认

Layer 2 的 peer 列表已包含双方 — 进入下一步。

### 3.2 发送测试消息

```bash
node -e "
const n=require('net');
const s=new n.Socket();
const buf=[];
s.on('data',d=>buf.push(d.toString()));
s.connect(8444,'127.0.0.1',()=>{
  s.write(JSON.stringify({type:'register',agent_id:'test-harness',host:'127.0.0.1',port:0,ts:new Date().toISOString()})+'\n');
  setTimeout(()=>{
    // 解析 peer 列表
    const lines=buf.join('').split('\n').filter(Boolean);
    const ack=JSON.parse(lines[0]);
    const beta=ack.peers.find(p=>p.agent_id==='agent-beta');
    if(!beta){console.log('FAIL: agent-beta not in registry');s.destroy();process.exit(1);}
    // 连接到 beta 的 P2P 端口
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

预期输出：

```
OK: message sent to agent-beta
```

### 3.3 验证接收方

检查 agent-beta 的 stderr 输出（来自 `run_background` 的 `job_output`）：

```bash
# 用 job_output 工具查看 agent-beta 的输出
```

预期输出中应包含：

```
[AgentRuntime] No route for: test_<id>
```

和

```json
{"method":"notifications/claude/channel","params":{...}}
```

**关键检查点：**

| 输出 | 含义 |
|------|------|
| `[AgentRuntime] No route for` | ✅ 消息到达本地 bus，但无对应 channel handler（测试消息正常） |
| `notifications/claude/channel` | ✅ MCP Server 生成了 channel 通知 |
| 两者都无 | ❌ 消息未到达 — Bridge 路由可能有问题 |

---

## Layer 4 — 消息投递（端到端）

验证 MCP 工具的完整调用链路。

### 4.1 前置条件

Layer 1-3 全部通过。两个 MCP Server 实例运行中。

### 4.2 模拟 MCP 调用

MCP Server 通过 `stdin` 接收 JSON-RPC，通过 `stdout` 返回响应。
以下模拟 `list_conversations` 调用：

```bash
echo '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"list_conversations","arguments":{}}}' | node dist/mcp_server.js --agent-id agent-alpha 2>/dev/null
```

预期输出（stdout）：

```json
{"jsonrpc":"2.0","id":"1","result":{"content":[{"type":"text","text":"(no conversations)"}]}}
```

### 4.3 跨实例 send_message 测试

这是最完整的端到端测试，需要两个实例运行中。

**测试方案：** 利用 `agent-beta` 的 `pendingMessages` 机制 — 任何发往 `agent.agent-beta.inbound` 的消息会进入 pending 队列，下次工具调用时返回。

执行测试（目标：从外部向 agent-beta 发消息，验证其 MCP 工具能读出）：

```bash
# 1. 通过 Bridge 向 agent-beta 发消息
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

# 2. 检查 agent-beta 的 job_output 确认收到
# 3. 验证 conversation store 有记录
```

---

## Layer 5 — MCP Notification

验证 `notifications/claude/channel` 能否被 Claude 消费。

> ⚠️ 本层需要 Claude Code 桌面端参与，无法在 headless 模式完全验证。
> 但 MCP Server 的 stderr 会打印通知 JSON，可提前确认格式正确。

### 5.1 检查通知格式

agent-beta 收到消息后，其 stderr 应输出：

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

### 5.2 已知问题

| 现象 | 原因 |
|------|------|
| Notification 已发出但 Claude 不显示 `<channel>` | 可能仅限于 marketplace 安装的插件。`--dangerously-load-development-channels` 可绕过此限制 |
| Claude 回复 "没有 agentgate 工具" | `.mcp.json` 路径不正确，或 MCP Server 启动报错 |

---

## 常见问题速查表

| 症状 | 可能原因 | 排查层 |
|------|---------|--------|
| MCP Server 启动无输出 | tsc 未构建 / 缺少依赖 | Layer 0 |
| "Self-bootstrapped as registry" 不出现 | 端口 8444 被残留进程占用 | Layer 0.2 |
| Agent ID 一直是 "default" | `~/.agentgate/agent_id` 文件影响 | Layer 0.3 |
| 注册中心只有 1 个 peer | 第二个实例未连接 / 连接到了残留注册中心 | Layer 2 |
| 消息发送成功但对方无响应 | MCP Server 的 `pendingMessages` 队列需下次工具调用才返回 | Layer 4 |
| Bridge 连接建立后立即断开 | 心跳超时 (60s) — 检查网络延迟 | Layer 3 |
| notification 已发但 Claude 不显示 | 版本限制 — 尝试 `--dangerously-load-development-channels` | Layer 5 |

---

## 分层排查流程

```
┌──────────────────────────────┐
│ Layer 0: 环境就绪            │  ← 从这里开始
│  npm run build 成功           │
│  netstat :8444 无残留         │
│  agent_id 文件预期            │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│ Layer 1: 单实例启动           │
│  node -e import 无报错        │
│  [AgentGate MCP] Running     │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│ Layer 2: 双实例注册           │
│  alpha: Self-bootstrapped    │
│  beta: Connected to registry │
│  probe 看到 2 peers           │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│ Layer 3: Bridge P2P 连通     │
│  发送方: OK message sent     │
│  接收方: channel notification│
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│ Layer 4: 端到端投递           │
│  MCP tools/call 正常         │
│  conversation store 有记录   │
└──────────┬───────────────────┘
           ▼
┌──────────────────────────────┐
│ Layer 5: Claude 显示         │  需要 GUI 环境
│  <channel> 块出现             │
└──────────────────────────────┘
```

每层通过后再进入下一层。如果某一层失败，无需继续上层排查。

---

## 诊断命令速记

| 目的 | 命令 |
|------|------|
| 构建 | `npm run build` |
| 检查端口 | `netstat -ano \| findstr ":8444 "` |
| 杀残留 | `taskkill /F /PID <PID>` |
| 启动 alpha | `node dist/mcp_server.js --agent-id agent-alpha` |
| 启动 beta | `node dist/mcp_server.js --agent-id agent-beta` |
| 查 peer 列表 | 见 Layer 2.3 的 probe 脚本 |
| 发测试消息 | 见 Layer 3.2 的脚本 |
| 模拟 MCP 调用 | `echo '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"list_conversations","arguments":{}}}' \| node dist/mcp_server.js --agent-id agent-alpha 2>/dev/null` |

---

## 常见修复记录

### Fix 1: `reply` 跨实例路由失效

**症状：** `send_message` 成功，`<channel>` 块出现，但 `reply` 后对端收不到。MCP Server 的 stderr 能看到 `[AgentRuntime] No route for: <msg_id>`。

**根因：** `src/mcp_server.ts` 的 `reply` handler 中：
1. `agent_id` 默认回落到当前 agent（self），Bridge 的 `routeToPeer` 检测到 target=self 时跳过
2. 消息被发布到 `agent.*.outbound`，Bridge 不转发 target=self 的 outbound 消息

**修复（2026-06-03）：**
```typescript
// 旧: 默认回落到自身 → Bridge 跳过
agent_id: targetAgent ?? config.server.defaultAgent

// 新: 从原消息推断发送者
const senderId = original?.channel_user_id || original?.agent_id
const replyTarget = (args.target_agent_id as string | undefined) || senderId
agent_id: replyTarget ?? config.server.defaultAgent

// 旧: outbound → Bridge 不转发
bus.publish(`agent.${response.agent_id}.outbound`, response)

// 新: inbound → Bridge 路由到目标 peer
bus.publish(`agent.${replyTarget}.inbound`, response)
```

**验证：** 启动 alpha + beta 实例，从外部通过 Bridge TCP 发送消息模拟跨实例通信，检查对端是否出现 `notifications/claude/channel`。
