# AgentGate Bridge 协议 v2

> 去中心化 agent 注册与 P2P 通信协议。
> Agent 通过阅读本文档了解如何配置端口、注册自身、发现其他 agent 并建立直连通信。

---

## 0. 快速开始

### 前置条件

- Node.js 24+
- `~/.claude.json` 已配置 `mcpServers.agentgate`（见下方）
- 项目已构建：`node_modules\.bin\tsc.cmd`
- 插件已同步：`xcopy /E /I /Y dist agentgate-plugin\dist`

### 配置 `~/.claude.json`

```json
{
  "mcpServers": {
    "agentgate": {
      "command": "node",
      "args": [
        "C:\\Projects\\AgentGate\\agentgate-plugin\\dist\\mcp_server.js",
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

> `${AGENTGATE_DEFAULT_AGENT}` 是环境变量占位符，Claude 在启动 MCP 进程前会将其替换为当前环境变量的值。
> 每个 Claude 实例设不同的值即可区分身份，无需修改配置文件。

### 单实例启动

```powershell
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
claude --dangerously-load-development-channels server:agentgate
```

首次启动需按 Enter 确认危险模式警告。之后可加 `--dangerously-skip-permissions` 跳过确认。

### 双实例启动（两个终端）

```powershell
# 终端 A
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
claude --dangerously-load-development-channels server:agentgate

# 终端 B
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
claude --dangerously-load-development-channels server:agentgate
```

启动后：
1. 第一个启动的 Claude 自举为注册中心（监听 :8444）
2. 第二个启动的 Claude 连接到注册中心，获知第一个的地址
3. 两者建立 P2P 直连
4. 任一 Claude 中用 `send_message` 工具发消息，另一侧自动收到 `<channel>` 块

### 三实例启动

```powershell
# 终端 A
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
$env:AGENTGATE_BRIDGE_PORT = "18445"     # 可选：指定 Bridge 端口
claude --dangerously-load-development-channels server:agentgate

# 终端 B
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
$env:AGENTGATE_BRIDGE_PORT = "18446"
claude --dangerously-load-development-channels server:agentgate

# 终端 C
$env:AGENTGATE_DEFAULT_AGENT = "agent-gamma"
$env:AGENTGATE_BRIDGE_PORT = "18447"
claude --dangerously-load-development-channels server:agentgate
```

所有 Agent 通过注册中心发现彼此，建立 P2P 全连通网络。

---

## 1. 架构概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Bridge 网络                                     │
│                                                                     │
│  注册中心 (:8444)         agent-alpha (:18445)    agent-beta (:18446)│
│  ┌────────────────┐      ┌──────────────┐       ┌──────────────┐   │
│  │ RegistryServer │◄────►│ PeerManager   │◄────►│ PeerManager   │   │
│  │                │      │              │       │              │   │
│  │ peers:         │      │ Registry     │       │ Registry     │   │
│  │  alpha:18445   │      │ Client       │       │ Client       │   │
│  │  beta :18446   │      │              │       │              │   │
│  └────────────────┘      └──────┬───────┘       └──────┬───────┘   │
│                                 │                      │           │
│                          直连 TCP (P2P) ◄─────────────►│           │
└─────────────────────────────────────────────────────────────────────┘
```

### 角色

| 角色 | 说明 | 数量 |
|------|------|------|
| **注册中心** (Registry) | 维护在线 agent 列表。第一个启动的 agent 自举成为注册中心 | 唯一，固定端口 8444 |
| **普通 agent** | 向注册中心注册后，与其他 agent 直连通信 | 任意多个 |

---

## 2. 端口分配

### 注册中心端口

**固定 8444**。第一个启动的 agent 在此端口启动 RegistryServer，成为注册中心。

### 普通 agent 端口

**可配置，默认 OS 自动分配**。优先级：

```
1. 环境变量 AGENTGATE_BRIDGE_PORT   → 指定端口
2. 文件 ~/.agentgate/ports/<agent_id> → 持久化上次端口
3. 操作系统自动分配 (port 0)         → 随机空闲端口
```

配置方式：

```powershell
# 方法 A：环境变量
$env:AGENTGATE_BRIDGE_PORT = "18445"
claude --dangerously-load-development-channels server:agentgate

# 方法 B：持久化文件
echo 18445 > ~\.agentgate\ports\agent-alpha

# 方法 C：不设置，自动分配
claude --dangerously-load-development-channels server:agentgate
```

---

## 3. 协议消息格式

所有消息为 **JSON Lines**（`\n` 分隔），基于 TCP。

### 3.1 注册阶段

#### REGISTER — agent 向注册中心注册

```json
{
  "type": "register",
  "agent_id": "agent-alpha",
  "host": "127.0.0.1",
  "port": 18445,
  "ts": "2026-06-03T14:00:00.000Z"
}
```

#### REGISTER_ACK — 注册中心的确认

```json
{
  "type": "register_ack",
  "agent_id": "agent-alpha",
  "peers": [
    { "agent_id": "agent-beta", "host": "127.0.0.1", "port": 18446, "seen_at": "2026-06-03T13:59:00.000Z" }
  ]
}
```

`peers` 数组包含**除自身外**所有当前在线的 agent。收到后应立即建立直连。

#### PEER_JOIN — 注册中心广播新 agent 上线

```json
{
  "type": "peer_join",
  "agent_id": "agent-gamma",
  "host": "127.0.0.1",
  "port": 18447
}
```

注册中心向**所有已在线的 agent** 广播此消息。收到后应主动连接新 peer。

#### PEER_LEAVE — agent 下线通知

```json
{
  "type": "peer_leave",
  "agent_id": "agent-gamma"
}
```

发送时机：
- agent 正常退出时主动发送
- 注册中心检测到 TCP 断开时广播

#### UNREGISTER — agent 主动下线

```json
{
  "type": "unregister",
  "agent_id": "agent-alpha"
}
```

发送后注册中心广播 PEER_LEAVE 并关闭连接。

### 3.2 通信阶段

#### MESSAGE — 跨 agent 消息

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

**路由规则**（由 `sendToPeer()` 决定）：

| topic 匹配 | 行为 |
|-----------|------|
| `agent.{agent_id}.inbound` | 转发给 `agent_id` 对应的 peer |
| `agent.{agent_id}.outbound` | 转发给 `agent_id` 对应的 peer |
| `_system.*` | 转发给所有 peer |
| `_system.conversation.*` | 转发给所有 peer |

### 3.3 心跳

```json
{"type": "heartbeat"}
{"type": "heartbeat_ack"}
```

心跳仅用于 **直连 peer 之间**，不经过注册中心。超时 60 秒无响应视为断开。

---

## 4. 生命周期

### 4.1 启动流程

```
1. 读取配置（端口 / agent_id）
2. 启动 BridgeServer（监听自己的端口）
3. 连接注册中心 (:8444)
4. 发送 REGISTER → 收到 REGISTER_ACK
5. 根据 REGISTER_ACK.peers 建立直连
6. 监听 PEER_JOIN → 连接新 peer
7. 进入通信阶段
```

### 4.2 注册中心自举

第一个启动的 agent 在 8444 启动 RegistryServer。后续 agent 连接 8444 时：

- 如果连接成功 → 自己是普通 agent
- 如果连接失败（端口被占用）→ 也作为普通 agent，不用自举
- 如果连接失败且 8444 无人监听 → 自己当注册中心

**特殊情况**：如果注册中心挂了，其他 agent 之间的已有直连**不受影响**，但新 agent 无法加入。恢复方式：重启任意一个 agent，它会尝试自举成为新注册中心。

### 4.3 断开检测

| 检测方式 | 对象 | 超时 |
|---------|------|------|
| TCP 断开事件 | 所有连接 | 即时 |
| 心跳超时 | peer 直连 | 60s |
| 注册中心检测 TCP 断开 | 普通 agent | 即时 |

---

## 5. 配置方式

### 5.1 `~/.claude.json` 配置

```json
{
  "mcpServers": {
    "agentgate": {
      "command": "node",
      "args": [
        "C:\\Projects\\AgentGate\\agentgate-plugin\\dist\\mcp_server.js",
        "--agent-id", "${AGENTGATE_DEFAULT_AGENT}"
      ]
    }
  }
}
```

**关键：** `${AGENTGATE_DEFAULT_AGENT}` 是**环境变量占位符**。Claude 在解析 `~/.claude.json` 时，会将 `${变量名}` 替换为当前进程环境变量的值。这不是 `mcp_server.js` 的参数展开，而是 Claude 自身的配置解析行为——在 spawn 子进程之前就完成了替换。

所以两个 Claude 实例可以共用同一份 `~/.claude.json`，只需在启动前设不同的环境变量即可区分身份。
```

### 5.2 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AGENTGATE_DEFAULT_AGENT` | `default` | 当前 agent 的身份 ID |
| `AGENTGATE_BRIDGE_PORT` | `0`（自动） | 当前 agent 的 Bridge 监听端口 |
| `AGENTGATE_BRIDGE_HOST` | `127.0.0.1` | 绑定的 host（本地开发用 localhost） |
| `AGENTGATE_REGISTRY_PORT` | `8444` | 注册中心端口 |
| `AGENTGATE_REGISTRY_HOST` | `127.0.0.1` | 注册中心地址 |
| `AGENTGATE_DIR` | `~/.agentgate` | 数据目录 |

### 5.3 启动示例

```powershell
# 终端 A — 自举为注册中心
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
$env:AGENTGATE_BRIDGE_PORT = "18445"
claude --dangerously-load-development-channels server:agentgate

# 终端 B — 普通 agent
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
$env:AGENTGATE_BRIDGE_PORT = "18446"
claude --dangerously-load-development-channels server:agentgate

# 终端 C — 自动分配端口
$env:AGENTGATE_DEFAULT_AGENT = "agent-gamma"
claude --dangerously-load-development-channels server:agentgate
```

---

## 6. 与 v1 的差异

| 方面 | v1（当前） | v2（新设计） |
|------|-----------|------------|
| 端口 | 固定 8444（所有 agent） | 每 agent 独立端口 |
| 注册中心 | 隐式自举 | 显式 REGISTER 协议 |
| 消息路由 | hub 中转 | P2P 直连 |
| 断开检测 | TCP 断开 | TCP 断开 + 心跳 |
| 配置 | 环境变量 | 环境变量 + 文件持久化 |
| 文档 | 无 | 本文档 |

---

## 7. 实现清单

- [ ] `RegistryServer` — 监听 8444，处理 REGISTER/UNREGISTER，广播 PEER_JOIN/PEER_LEAVE
- [ ] `RegistryClient` — 向注册中心注册，维护 peer 列表
- [ ] `PeerConnection` — 直连 TCP 管理，心跳，断线重连
- [ ] `PeerManager` — 管理所有 peer 连接，根据 topic 路由消息
- [ ] 端口分配策略 — 环境变量 > 文件 > 自动
- [ ] 自举逻辑 — 先尝试连接 8444，失败则自举
- [ ] 旧 BridgeServer/BridgeClient 移除
