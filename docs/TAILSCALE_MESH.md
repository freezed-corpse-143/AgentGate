# AgentGate Tailscale 组网

> 利用 Tailscale 的虚拟专用网络，让分布在不同机器上的 AgentGate agent 直接通信。
> 零配置、零端口暴露、传输加密（WireGuard）。

---

## 1. 背景

Bridge v2 的 P2P 直连有两个硬性条件：
- 每台机器需要一个**可达的 IP + 端口**
- 防火墙/NAT 不能阻挡 TCP 连接

SSH 隧道能解决但麻烦：手动配端口转发、端口动态变化要更新隧道、SSH 断开要重连。

**Tailscale 在 OS 层建一个虚拟局域网**，每台机器获得一个固定的 Tailscale IP（`100.x.x.x`），从此所有机器「看起来在同一个交换机上」。AgentGate 不需要知道底层网络差异。

### 与 SSH 隧道对比

| 对比项 | SSH 隧道 | Tailscale |
|--------|----------|-----------|
| 安装 | 自带（Linux/Mac） | 需安装 Tailscale |
| 配置 | 每端口一条 `-L` | `tailscale up` 一次 |
| 端口动态变化 | 需更新隧道 | 不需要（直达机器） |
| NAT 穿透 | ❌ 需要公网跳板机 | ✅ DERP 中继 |
| 加密 | SSH 传输层 | WireGuard 传输层 |
| 保活 | `ServerAliveInterval` | 内置心跳 |
| 代码改动 | 0 | 0 |

---

## 2. 安装与组网

### 2.1 安装 Tailscale

每台机器安装 Tailscale 并登录同一账号。

```bash
# Linux
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# macOS
brew install tailscale && tailscale up

# Windows
# 下载安装: https://tailscale.com/download
# 运行后点击登录

# 验证
tailscale status
# 100.x.x.x  machine-a
# 100.x.x.y  machine-b
```

### 2.2 验证连通性

```bash
# Machine A
ping 100.x.x.y
# → 通

# Machine B
ping 100.x.x.x
# → 通
```

---

## 3. 用 Tailscale IP 启动 AgentGate

### 3.1 架构图

```
Machine A (Tailscale IP 100.1.2.3)       Machine B (Tailscale IP 100.1.2.4)
┌─────────────────────────┐             ┌─────────────────────────┐
│ RegistryServer :8444    │◄────Tailscale────►│ agent-beta           │
│ 监听 100.1.2.3:8444     │   WireGuard 加密  │ registryHost: 100.1.2.3│
│                         │             │ bridge port: 自动       │
│ agent-alpha             │             │ P2P 直达 Machine A      │
│  registryHost: 127.0.0.1│             └─────────────────────────┘
└─────────────────────────┘
```

**关键区别**：Tailscale 网络内的机器直接用 Tailscale IP 通信。BridgeAgent 的 `registryHost` 填 `100.x.x.x`，P2P 直连也通过 `100.x.x.x`。

### 3.2 启动注册中心（Machine A）

```bash
# Machine A — 监听在 Tailscale IP 上，这样其他机器能连
node dist/index.js bridge 8444

# 默认监听 0.0.0.0:8444
# 确认 Tailscale 网卡上能访问：
# tailscale ip -4 → 100.1.2.3
```

### 3.3 启动 agent-alpha（Machine A，本机）

```bash
# Machine A
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
node dist/index.js start --bridge

# agent-alpha 连接 127.0.0.1:8444（同机 Registry）
# P2P 端口自动分配
```

### 3.4 启动 agent-beta（Machine B，跨机器）

```bash
# Machine B
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
$env:AGENTGATE_REGISTRY_HOST = "100.1.2.3"   # Machine A 的 Tailscale IP
$env:AGENTGATE_BRIDGE_HOST = "100.1.2.4"     # 本机 Tailscale IP（通知 peer 连这个地址）
node dist/index.js start --bridge
```

关键日志：
```
[Bridge] Listening on 100.1.2.4:xxxxx
[Bridge] Connected to registry at 100.1.2.3:8444
[Bridge] Peer joined: agent-alpha (100.1.2.3:xxxxx)
[Bridge] P2P connected to agent-alpha
```

**没有隧道、没有端口转发、没有 SSH 保活。**

---

## 4. 配置详解

### 4.1 环境变量

| 变量 | 值 | 说明 |
|------|-----|------|
| `AGENTGATE_REGISTRY_HOST` | `100.x.x.x` | 注册中心的 Tailscale IP |
| `AGENTGATE_BRIDGE_HOST` | 本机 Tailscale IP | **新增/修改**：BridgeAgent 注册时用 Tailscale IP 而非 `127.0.0.1` |

### 4.2 `advertiseHost` — 向注册中心声明本机地址

`BridgeAgentOptions` 中的 `advertiseHost` 字段解决了这个问题：

```typescript
export interface BridgeAgentOptions {
  agentId: string
  bus: MessageBus
  listenPort?: number
  registryHost?: string
  registryPort?: number
  /** 向注册中心声明的本机地址。跨机器通信时设为本机的 Tailscale IP 或公网 IP */
  advertiseHost?: string
}
```

默认值为 `127.0.0.1`（向前兼容，单机场景不受影响）。
跨机器时通过 `AGENTGATE_BRIDGE_HOST` 环境变量或编程方式设置。**此功能已实现，可直接使用。**

### 4.3 完整配置示例

```bash
# Machine A（注册中心 + agent-alpha）
node dist/index.js bridge 8444

$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
$env:AGENTGATE_BRIDGE_HOST = "100.1.2.3"   # 本机 Tailscale IP
node dist/index.js start --bridge

# Machine B（agent-beta）
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
$env:AGENTGATE_REGISTRY_HOST = "100.1.2.3" # Machine A 的 Tailscale IP
$env:AGENTGATE_BRIDGE_HOST = "100.1.2.4"   # 本机 Tailscale IP
node dist/index.js start --bridge

# Machine C（agent-gamma）
$env:AGENTGATE_DEFAULT_AGENT = "agent-gamma"
$env:AGENTGATE_REGISTRY_HOST = "100.1.2.3"
$env:AGENTGATE_BRIDGE_HOST = "100.1.2.5"
node dist/index.js start --bridge
```

---

## 5. Tailscale 高阶技巧

### 5.1 用 ACL 控制 agent 访问

```json
// Tailscale ACL (https://login.tailscale.com/admin/acls)
{
  "acls": [
    // 只允许 agent 之间的 Bridge 端口通信
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

### 5.2 固定 Tailscale IP

```bash
# Tailscale 默认 IP 不变，但如果重新登录可能变化
# 用 MagicDNS 更稳定：
tailscale up --accept-dns

# 然后直接用机器名：
ping machine-a       # → 100.x.x.x
ping machine-b       # → 100.x.x.y
```

### 5.3 纯内网机器（无公网 IP）

Tailscale 的 DERP 中继会自动处理 NAT 穿透。不需要公网跳板机。

---

## 6. 与 SSH 隧道方案的选择

| 你的环境 | 推荐方案 |
|----------|---------|
| 已有公网跳板机，不能装 Tailscale | SSH 隧道（`docs/SSH_MESH.md`） |
| 机器都能装 Tailscale | **Tailscale**（本文档） |
| 混合：部分能装 Tailscale，部分不能 | Tailscale 为主，SSH 隧道作为 fallback |
| 只想单机测试 | 什么都不用做，`localhost` 直连 |

---

## 7. 小结

Tailscale 方案对 AgentGate 的收益：

- **零代码改动**（除了新增 `advertiseHost` 选项和 `AGENTGATE_BRIDGE_HOST` 环境变量）
- **零端口管理**——不需要配 `-L` 转发，不需要关注动态端口
- **自带加密**——WireGuard 传输层加密，无需改造 P2P 协议
- **自动保活**——内置心跳，断线自动重连
- **NAT 穿透**——DERP 中继，无需公网服务器
