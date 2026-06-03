# Claude 双实例通信 — 实测报告与协议分析

> 本文档记录 AgentGate 实现两个 Claude Code 实例间直接通信的全过程，
> 包括架构设计、实测结果、与官方 Telegram 插件的对比分析，以及 `notifications/claude/channel` 协议研究。
>
> **当前状态：** Bridge 已升级到 v2（去中心化注册 + P2P 直连），详见 `BRIDGE_PROTOCOL.md`。
> 本文档的架构图对应旧版 Bridge v1（hub + client 模式），但仍包含 channel 协议分析、notification 调试等仍有效的内容。

---

## 一、架构总览

### 1.1 目标

两个 Claude Code 实例（进程），各自加载 AgentGate MCP 插件，通过嵌入式 TCP Bridge 互联，
实现跨进程消息传递。不依赖任何外部服务。

### 1.2 分层架构

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

### 1.3 消息流

```
Claude A 用户说:
  "用 send_message 给 agent-beta 发消息"

  → Claude A 调用 MCP tool: send_message(target_agent_id="agent-beta", text="你好")
    → MCP Server A 的 handler:
      1. 创建 Envelope { agent_id: "agent-beta", text: "你好" }
      2. conversationStore.appendMessage(...)  // 写入本地存储
      3. bus.publish("agent.agent-beta.inbound", envelope)
        → BridgeClient A 的 wildcard 捕获
          → 通过 TCP 发送到 BridgeServer (port 8444)
            → BridgeServer 广播给除发送者外的所有客户端
              → BridgeClient B 收到
                → bus.publish("agent.agent-beta.inbound", envelope)
                  → MCP Server B 的 subscriber 捕获
                    → 检查 agent_id === "agent-beta" → 匹配
                    → 1. conversationStore.appendMessage(...)   // 存到本地
                    → 2. pendingMessages.push(...)               // 加入待处理队列
                    → 3. mcp.notification({ method: 'notifications/claude/channel' })
                      → (尝试推送通知给 Claude B，实测此版本不工作)
```

---

## 二、实测结果

### 2.1 环境

| 项目 | 值 |
|------|-----|
| 操作系统 | Windows 11 |
| Claude 版本 | deepseek-v4-pro (claude.exe, 234MB Bun 编译) |
| 启动方式 | `claude --plugin-dir agentgate-plugin` |
| Agent ID 传递 | 文件 `~/.agentgate/agent_id`（env 变量不传递到 MCP 子进程） |
| Bridge 端口 | 8444（自动组网: 先启动者为 hub, 后启动者为 peer） |
| MCP SDK | `@modelcontextprotocol/sdk@^1.29.0` |

### 2.2 验证结果

| 验证项 | 结果 | 说明 |
|--------|------|------|
| Bridge 互联 | ✅ | total: 2, 两个 BridgeClient 成功连接 |
| send_message 跨进程 | ✅ | 消息通过 bridge 到达对方 MemoryBus |
| 消息存入 conversation store | ✅ | 双方各自存储，ConversationSync 跨进程同步 |
| pendingMessages 队列 | ✅ | 未读消息暂存，下次工具调用时返回 |
| list_conversations 可查 | ✅ | 对方可通过 list_conversations 看到新消息 |
| notifications/claude/channel | ❌ | MCP 通知已发送，但 Claude 不显示 |

### 2.3 已知问题

| 问题 | 根因 | 状态 |
|------|------|------|
| 消息不能主动弹出 | `notifications/claude/channel` 在此版本不工作 | ⚠️ 有替代方案 |
| env 变量不传递 | Claude 启动 MCP 子进程时不继承终端 env | ✅ 已改文件读取 |
| `reply` 工具需要 conv_id | 跨进程时本地 store 可能没有该对话 | ✅ 已添加 send_message |

### 2.4 实际使用流程

```powershell
# 终端 A
echo agent-alpha > $env:USERPROFILE\.agentgate\agent_id
claude --plugin-dir C:\Projects\AgentGate\agentgate-plugin

# 在 Claude A 中:
# "用 send_message 工具给 agent-beta 发消息，内容写"你好""

# 终端 B
echo agent-beta > $env:USERPROFILE\.agentgate\agent_id
claude --plugin-dir C:\Projects\AgentGate\agentgate-plugin

# 在 Claude B 中:
# "列出最近的对话" → 会看到新对话
# 或直接输入任何内容，工具返回时自动附加待处理消息
```

---

## 三、Channel 协议深度分析

### 3.1 MCP 协议中的 channel 机制

`notifications/claude/channel` 是 **Claude Code 的实验性扩展**，不在标准 MCP 协议中。实现涉及三层：

#### 第一层: Capability 声明

MCP Server 初始化时声明支持 channel:

```typescript
const mcp = new Server(
  { name: 'agentgate', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},           // 声明可以注入消息
        'claude/channel/permission': {}, // 声明可认证消息来源
      },
    },
  },
)
```

Claude 收到 InitializeResponse 时看到 experimental capabilities，如果支持则启用 channel 功能。

#### 第二层: 发送 notification

MCP Server 通过 `mcp.notification()` 发送 JSON-RPC notification:

```typescript
mcp.notification({
  method: 'notifications/claude/channel',
  params: {
    content: "消息文本",
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

MCP SDK 将此序列化为 JSON-RPC 通知并通过 stdio 发送:
```json
{
  "jsonrpc": "2.0",
  "method": "notifications/claude/channel",
  "params": {
    "content": "消息文本",
    "meta": { ... }
  }
}
```

#### 第三层: Claude 客户端处理

Claude Code 收到 JSON-RPC 通知后:
1. 解析 method 为 `notifications/claude/channel`
2. 检查 MCP Server 是否声明了 `claude/channel` capability
3. 检查 `~/.claude.json` 中的 `tengu_harbor` 配置
4. 如通过，将消息渲染为 `<channel>` 标签插入会话上下文

### 3.2 `~/.claude.json` 配置

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

`tengu_harbor_ledger` 是 channel 功能的白名单。`marketplace: "local"` 条目对应 `--plugin-dir` 加载的插件。

### 3.3 Telegram 插件 vs AgentGate 实现对比

| 方面 | Telegram 插件 | AgentGate |
|------|-------------|-----------|
| 运行时 | Bun | Node.js |
| MCP SDK | `^1.0.0` | `^1.29.0` |
| Capability | `claude/channel` + `claude/channel/permission` | 相同 |
| 通知方式 | `void mcp.notification({...})` fire-and-forget | `mcp.notification({...}).catch()` |
| 通知内容 | `{ content, meta: { chat_id, user, user_id, ts } }` | `{ content, meta: { chat_id, agent_id, conversation_id, trace_id, source, ts } }` |
| env 传递 | 通过 `.env` 文件读取 token | ✅ 已实现文件读取 agent_id |
| 安装方式 | marketplace 安装 | `--plugin-dir` |

**核心差异**: 通知格式和调用方式**完全一致**。Telegram 插件能工作而 AgentGate 不能，可能的原因是:

1. **安装方式不同**: Claude 对 marketplace 插件和 `--plugin-dir` 插件可能区别对待
2. **harbor ledger 识别**: `marketplace: "local"` 条目可能不被识别
3. **Claude 版本限制**: channel 功能可能被限制在特定 Claude 版本或模型中

### 3.4 MCP SDK 通知发送流程

在 `@modelcontextprotocol/sdk` 中，`notification()` 方法:

```
Server.notification(params)
  → Protocol.notification(params)         // 继承自 Protocol 类
    → assertNotificationCapability(method) // 检查方法是否被 capabilities 允许
      → switch(method):
          'notifications/message'          → 需要 logging capability
          'notifications/resources/*'      → 需要 resources capability
          'notifications/tools/*'          → 需要 tools capability
          'notifications/prompts/*'        → 需要 prompts capability
          'notifications/cancelled'        → 始终允许
          'notifications/progress'         → 始终允许
          'notifications/claude/channel'   → 未匹配任何 case → 不报错也不拦截
    → transport.send(message)             // 通过 stdio 发送 JSON-RPC
```

关键发现: `assertNotificationCapability()` 中没有 `notifications/claude/channel` 的 case，
所以它既不会报错也不会被拦截，直接通过 transport 发送。

---

## 四、Bridge 协议

### 4.1 传输层

TCP + 换行分隔 JSON (JSON Lines)

```
→ {"type":"hello","node_id":"node-DESKTOP-7E8RPQH-12345"}
→ {"type":"message","topic":"agent.agent-beta.inbound","envelope":{...}}
→ {"type":"heartbeat"}
← {"type":"heartbeat_ack"}
```

### 4.2 自动组网

每个 MCP Server 启动时:
1. 尝试在 8444 端口启动 BridgeServer（监听 0.0.0.0）
2. 如果端口被占用 → 对方已是 Server，本机当 Client
3. 同时启动 BridgeClient 连接 127.0.0.1:8444（不论是 Server 还是 Client）

无需配置文件，无需单独启动 bridge 服务。

### 4.3 消息 Topic

| Topic | 方向 | 用途 |
|-------|------|------|
| `agent.{id}.inbound` | → | Agent 入站消息 |
| `agent.{id}.outbound` | ← | Agent 出站回复 |
| `_system.*` | → | 系统内部消息 |
| `_system.conversation.*` | → | 对话同步 |

---

## 五、待处理消息机制

由于 `notifications/claude/channel` 推送不工作，实现拉取式替代方案:

1. 入站消息到达 → 存入 `pendingMessages[]` 队列
2. 下次 Claude 调用任意 MCP 工具时
3. 响应末尾附加:

```
📬 待处理消息 (1):
  🔔 agent-alpha: "你好" (conv: conv_xxx)

用 reply 工具回复，conv_id 如上。
```

4. 队列在返回后被清空

---

## 六、MCP SDK notification() 调用链路

```
mcp.notification({ method: 'notifications/claude/channel', params })
  → Protocol.notification()
    → assertNotificationCapability('notifications/claude/channel')
      → switch('notifications/claude/channel'):
          // 未匹配任何 case → 不抛错，放行
    → this._transport.send(jsonRpcMessage)
      → StdioServerTransport.send()
        → process.stdout.write(JSON.stringify(message))
```

**关键发现**: `assertNotificationCapability()` 只检查标准 MCP notification methods：
`notifications/message`, `notifications/resources/*`, `notifications/tools/*`,
`notifications/prompts/*`, `notifications/cancelled`, `notifications/progress`。

`notifications/claude/channel` 不在任何 case 中 → **既不报错也不拦截** → 直接发送。

这意味着：
1. MCP SDK 侧 ✅ — notification 已通过 stdio 发送给 Claude
2. Claude 侧 ❌ — 收到了但不处理/不显示

## 七、结论：推送不工作的可能原因

| 原因 | 可能性 | 说明 |
|------|--------|------|
| `--plugin-dir` 与 marketplace 区别对待 | 高 | Telegram 插件通过 marketplace 安装，可能享有不同权限 |
| harbor ledger 配置不被识别 | 中 | `marketplace: "local"` 条目可能不被 Claude 识别 |
| Claude 版本限制 | 中 | channel 功能可能被 gated 在特定版本/模型中 |
| notifications/claude/channel 的 .catch() | 低 | mcp.notification() 确实被调用了 |
| MCP SDK 版本差异 | 低 | 1.0.0 vs 1.29.0 的 notification 方法一致 |

## 八、通过 unbuned 解包 claude.exe

成功使用 [unbuned](https://github.com/vibheksoni/unbuned) 提取 Claude 源码：

```bash
python unbuned.py claude.exe
# → output/claude/claude.js (15,335,959 bytes, 15MB)
```

### 发现

1. **代码完全 minified** — 所有变量名被缩短为单字母（`H`, `$`, `A`, `L`, `D` 等），难以分析特定逻辑
2. **连接类型** — Claude 使用多种连接方式：
   - MCP stdio（标准输入输出 JSON-RPC）
   - Chrome Bridge WebSocket（用于浏览器自动化）
3. **关键发现**: 在 bridge 连接处理器中发现：
   ```javascript
   case"notification":if(this.notificationHandler)
     this.notificationHandler({method:H.method,params:H.params});
   ```
   说明 Claude 通过 `notificationHandler` 处理来自插件的通知
4. **`tengu` 引用** — 多处出现 `tengu` 作为事件追踪/打点标识
5. **`claude/channel` capability** — 在 MCP Server 初始化代码中可以找到 experimental capabilities 声明

### 限制

- 15MB 的 minified JS 无法有效搜索特定逻辑
- 变量名全部被缩短，无法通过变量名推断功能
- 实际 channel 通知的渲染逻辑可能在编译后的字节码中，不在 JS bundle 里

### 与 wakaru 对比

| 工具 | 结果 |
|------|------|
| wakaru | ❌ 无法处理 Bun 编译的 PE 二进制 |
| unbuned | ✅ 成功提取 15MB minified JS，但代码被严重混淆 |

claude.exe (234MB) 是 **Bun 编译的单文件二进制**，包含编译后的字节码。
JavaScript 源码被编译为 Bun 内部格式，无法使用 wakaru（JS/TS 解包器）还原。

可分析的公开资源:
- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/telegram/server.ts` — Telegram 插件完整源码
- `node_modules/@modelcontextprotocol/sdk/` — MCP SDK 完全开源
- `~/.claude.json` — Claude 配置文件（channel/harbor 配置）

---

## 七、测试命令参考

```bash
# 构建
cd C:\Projects\AgentGate && npm run build

# 同步插件
Copy-Item -Recurse -Force dist/* agentgate-plugin/dist/

# 设置 agent_id
echo agent-alpha > $env:USERPROFILE\.agentgate\agent_id

# 启动 Claude
claude --plugin-dir C:\Projects\AgentGate\agentgate-plugin

# 单独测试 MCP server
node dist/mcp_server.js

# 运行测试
npx vitest run tests/unit tests/integration
npm run test:telegram
```
