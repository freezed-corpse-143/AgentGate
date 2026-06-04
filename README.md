# AgentGate — Claude Code 多 Agent 通信插件

[![CI](https://github.com/freezed-corpse-143/AgentGate/actions/workflows/ci.yml/badge.svg)](https://github.com/freezed-corpse-143/AgentGate/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D22-brightgreen)](https://nodejs.org/)

AgentGate 是一个 **Claude Code MCP 插件**，利用 `notifications/claude/channel` 机制将消息自动注入到 Claude 会话上下文中，并通过去中心化的 Bridge v2 协议实现多 Agent 间的 P2P 直连通信。

**不依赖 Telegram API 或任何外部服务。** 核心机制参考官方 Telegram 插件的上下文注入模式。

---

## 快速开始

### 前置条件

- Node.js 24+
- Claude Code v2.1.150+
- `~/.claude.json` 已配置（见下方）

### 安装

#### 方式 A：从 GitHub Clone（推荐）

```bash
git clone https://github.com/freezed-corpse-143/AgentGate.git
cd AgentGate
npm install
npm run build
```

#### 方式 B：使用 Claude Plugin Directory（开发模式）

```bash
claude --plugin-dir /path/to/AgentGate --dangerously-load-development-channels server:agentgate
```

### 配置 `~/.claude.json`

将 `<AGENTGATE_DIR>` 替换为你的实际路径（如 `/home/user/AgentGate` 或 `C:\Users\name\AgentGate`）：

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

> `${AGENTGATE_DEFAULT_AGENT}` 是环境变量占位符，Claude 在启动 MCP 进程前会将其替换为实际值。
> 每个 Claude 实例设不同的值即可区分身份，无需修改配置文件。

### 构建

```bash
npm run build
```

### 启动（单实例）

```powershell
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
claude --dangerously-load-development-channels server:agentgate
```

首次启动需按 Enter 确认危险模式警告。

### 双实例通信

```powershell
# 终端 A
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
claude --dangerously-load-development-channels server:agentgate

# 终端 B
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
claude --dangerously-load-development-channels server:agentgate
```

启动后任一实例中用 `send_message` 工具发消息，另一侧自动在上下文中显示 `<channel>` 块。

---

## 架构

```
┌─ Claude A (agent-alpha) ─────────────────┐
│                                           │
│  MCP Server (mcp_server.js               │
│    ├── send_message / reply / react       │
│    ├── list_conversations / edit_message  │
│    └── notifications/claude/channel       │
│                                           │
│  BridgeAgent (:18445)                     │
│    ├── RegistryClient → 注册中心 :8444    │
│    └── PeerManager → P2P 直连            │
└──────────────┬────────────────────────────┘
               │ P2P TCP
               ▼
┌─ Claude B (agent-beta) ──────────────────┐
│                                           │
│  BridgeAgent (:18446)                     │
│    ├── RegistryClient → 注册中心 :8444    │
│    └── PeerManager → P2P 直连            │
│                                           │
│  MCP Server (mcp_server.js)              │
│    └── notifications/claude/channel       │
└───────────────────────────────────────────┘
```

### 消息流

```
Claude A 用户："用 send_message 给 agent-beta 发消息"

1. Claude A 调用 MCP tool: send_message(target_agent_id="agent-beta", ...)
2. Envelope 发布到 MemoryBus → agent.agent-beta.inbound
3. BridgeAgent.routeToPeer("agent-beta", ...) → P2P TCP 直连
4. Beta 的 BridgeAgent 收到 → bus.publish(...)
5. Beta 的 MCP Server 订阅触发 → mcp.notification(notifications/claude/channel)
6. Beta 的 Claude 收到 → 上下文自动出现 <channel source="agentgate" ...>
```

---

## Bridge v2 协议

去中心化注册 + P2P 直连，详见 [docs/BRIDGE_PROTOCOL.md](docs/BRIDGE_PROTOCOL.md)。

| 组件 | 说明 |
|------|------|
| **注册中心** | 固定端口 8444，第一个启动的 agent 自举。管理 agent 列表，广播上下线 |
| **P2P 直连** | agent 间直接 TCP 通信，不经过注册中心中转 |
| **端口分配** | 默认 OS 自动分配，可通过 `AGENTGATE_BRIDGE_PORT` 指定 |
| **心跳** | 15s 间隔，60s 超时断开 |

---

## MCP 工具

| 工具 | 用途 |
|------|------|
| `send_message` | 发送新消息到另一个 agent。传 `target_agent_id` 和 `text` |
| `reply` | 回复指定对话。传 `conv_id`、`text`，可指定 `target_agent_id` 跨实例路由 |
| `list_conversations` | 列出最近对话 |
| `react` | 表情回应 |
| `edit_message` | 编辑已发送的回复 |

---

## 项目结构

```
src/
  mcp_server.ts              — MCP Server 入口（核心）
  server.ts                  — 服务启动函数
  config.ts                  — 配置加载
  types.ts                   — 类型定义
  index.ts                   — CLI 入口

  bus/
    memory_bus.ts            — 发布/订阅消息总线
    peer_bridge.ts           — Bridge v2：注册 + P2P 直连
    outbound_dispatcher.ts   — 出站消息分发

  agents/
    registry.ts              — Agent 注册中心
    runtime.ts               — 消息路由 + 循环检测

  auth/
    binding_store.ts         — 绑定存储
    handshake.ts             — 配对握手

  channels/
    base.ts                  — 信道适配器接口
    telegram_adapter.ts      — Telegram 信道
    ssh_adapter.ts           — SSH 信道
    rest_adapter.ts          — REST API 信道

  gateway/
    channel_gateway.ts       — 消息网关
    envelope.ts              — 消息模型 + 循环检测

  sessions/
    router.ts                — 会话路由
    session_registry.ts      — 会话注册

  storage/
    conversation_store.ts    — 消息持久化
    conversation_sync.ts     — 跨进程同步

.mcp.json                  — MCP server 注册
.claude-plugin/            — 插件 manifest
skills/                    — Skill 插件

docs/
  BRIDGE_PROTOCOL.md         — Bridge v2 协议文档
  CLAUDE_COMMS.md            — 实测报告与 channel 协议分析
  DEBUG.md                   — 调试指南
  SSH_MESH.md                — SSH 跨主机组网方案

tests/
  unit/                      — 10 文件, 85 测试
  integration/               — 集成测试
  e2e/                       — 端到端测试
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AGENTGATE_DEFAULT_AGENT` | `default` | 当前 agent 的身份 ID |
| `AGENTGATE_BRIDGE_PORT` | `0`（自动分配） | 当前 agent 的 Bridge 监听端口 |
| `AGENTGATE_REGISTRY_PORT` | `8444` | 注册中心端口 |
| `AGENTGATE_REGISTRY_HOST` | `127.0.0.1` | 注册中心地址 |
| `AGENTGATE_DIR` | `~/.agentgate` | 数据目录 |

---

## 开发

```bash
# 构建
npm run build

# 测试
npx vitest run tests/unit        # 85 单元测试
npx vitest run tests/integration # 集成测试

# 启动 Claude（单实例）
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
claude --dangerously-load-development-channels server:agentgate
```

---

## 参考

### 文档
- [docs/BRIDGE_PROTOCOL.md](docs/BRIDGE_PROTOCOL.md) — Bridge v2 协议
- [docs/CLAUDE_COMMS.md](docs/CLAUDE_COMMS.md) — channel 协议分析与实测报告
- [docs/DEBUG.md](docs/DEBUG.md) — 调试指南
- [docs/SSH_MESH.md](docs/SSH_MESH.md) — SSH 跨主机组网方案
- [docs/TAILSCALE_MESH.md](docs/TAILSCALE_MESH.md) — Tailscale 跨主机组网方案

### CI/CD
- `.github/workflows/ci.yml` — GitHub Actions: typecheck + unit tests + integration tests + build
- `Dockerfile` — 多阶段构建，生产镜像仅 100MB+
- 测试: `npm test`（unit + integration，排除 e2e），`npm run typecheck`
