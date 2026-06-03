# AgentGate SSH Mesh 组网

> 利用 SSH 隧道连接分布在不同机器上的 AgentGate Bridge Agent。
> 适用于跨主机的 agent 协作场景。

---

## 1. 背景

当前 Bridge v2 的注册发现和 P2P 直连仅在 **单机 localhost** 范围内工作。当 agent 运行在不同主机上时：

- 注册中心 8444 端口无法跨主机访问（除非暴露端口）
- P2P 直连 TCP 也被防火墙/NAT 阻挡
- 需要一种安全的跨主机隧道方案

SSH 是解决这个问题的自然选择：
- 几乎所有服务器都运行 SSH 服务
- SSH 端口转发（Port Forwarding）可以安全地暴露内部端口
- SSH 连接自带加密和认证

---

## 2. 思路

**SSH 隧道把远程端口映射到本地，让跨机器的 agent 看起来像跑在同一台机器上。**

```
你的机器                          目标机器 (target-machine)
┌──────────────────┐           ┌──────────────────────────┐
│ SSH -L 18445     │           │ agent-alpha :18445       │
│ SSH -L 18446     │── SSH ──►│ agent-beta  :18446       │
│ SSH -L 18447     │           │ agent-gamma :18447       │
│                  │           │ RegistryServer :8444     │
│ SSH -L 8444      │           │                          │
└──────────────────┘           └──────────────────────────┘
```

映射后在你的机器上看：
```
localhost:18445  =  target-machine:18445 (agent-alpha)
localhost:18446  =  target-machine:18446 (agent-beta)
localhost:18447  =  target-machine:18447 (agent-gamma)
localhost:8444   =  target-machine:8444  (RegistryServer)
```

你的 BridgeAgent 配置 `registryHost: "127.0.0.1"`，所有 agent 像本地一样通信。

---

## 3. 手动建立 SSH 隧道

### 3.1 场景一：目标机运行所有 agent + 注册中心

```bash
# 一条 SSH 命令，把目标机的全部端口拉到本地
ssh -L 8444:localhost:8444 \
     -L 18445:localhost:18445 \
     -L 18446:localhost:18446 \
     -L 18447:localhost:18447 \
     user@target-machine -N
```

如果 SSH 端口不是 22：

```bash
ssh -L 8444:localhost:8444 \
     -L 18445:localhost:18445 \
     -L 18446:localhost:18446 \
     -L 18447:localhost:18447 \
     -p 2222 user@target-machine -N
```

`-N` 表示不执行远程命令，只做端口转发。

### 3.2 场景二：你的机器也要加入组网

```bash
# 既拉取远程端口，也把你本地的 Bridge 端口暴露到目标机
ssh -L 8444:localhost:8444 \
     -L 18445:localhost:18445 \
     -L 18446:localhost:18446 \
     -R 18448:localhost:18448 \
     user@target-machine -N
```

`-R 18448:localhost:18448` 表示：目标机上的 18448 转发到你的 18448。

### 3.3 场景三：目标机只有 SSH 端口开放

即使目标机防火墙只开了 22 端口，SSH 隧道可以穿透所有需要的端口：

```bash
ssh -L 8444:localhost:8444 -L 18445:localhost:18445 user@target-machine -N
```

SSH 在应用层建立隧道，不受目标机防火墙规则限制（只要 SSH 能连上）。

---

## 4. 完整启动流程

### 4.1 启动注册中心（在目标机上）

```bash
# 目标机终端
node dist/index.js bridge 8444
```

### 4.2 启动 agent-alpha（在目标机上）

```bash
# 目标机终端
$env:AGENTGATE_DEFAULT_AGENT = "agent-alpha"
$env:AGENTGATE_BRIDGE_PORT = "18445"
node dist/index.js start
```

### 4.3 启动 agent-beta（在目标机上）

```bash
# 目标机另一个终端
$env:AGENTGATE_DEFAULT_AGENT = "agent-beta"
$env:AGENTGATE_BRIDGE_PORT = "18446"
node dist/index.js start
```

### 4.4 建立 SSH 隧道（在你的机器上）

```bash
# 你的机器终端 — 一条 SSH 拉取所有端口
ssh -L 8444:localhost:8444 -L 18445:localhost:18445 -L 18446:localhost:18446 user@target-machine -N
```

保持此终端运行，不要关闭。

### 4.5 启动你的本地 agent

```bash
# 你的机器另一个终端
$env:AGENTGATE_DEFAULT_AGENT = "agent-delta"
$env:AGENTGATE_BRIDGE_PORT = "18448"
$env:AGENTGATE_REGISTRY_HOST = "127.0.0.1"    # ← 通过 SSH 隧道访问目标机注册中心
node dist/index.js start
```

### 4.6 验证

查看 agent-delta 的启动日志，应看到：

```
[Bridge] Connected to registry at 127.0.0.1:8444
[Bridge] Registered: agent-delta
[Bridge] Peer joined: agent-alpha (127.0.0.1:18445)
[Bridge] Peer joined: agent-beta (127.0.0.1:18446)
```

四个 agent 都在同一个 Registry 下，P2P 直连通过 SSH 隧道中转。

---

## 5. 隧道类型参考

| SSH 参数 | 方向 | 说明 |
|----------|------|------|
| `-L 18445:localhost:18445` | 拉取 | 目标机 `:18445` → 本机 `:18445` |
| `-R 18448:localhost:18448` | 暴露 | 本机 `:18448` → 目标机 `:18448` |
| `-D 1080` | SOCKS | 不推荐，端口级转发更精确 |

可以多条 `-L` / `-R` 混写，一条 SSH 连接承载多个转发。

---

## 6. 断开后重连

SSH 隧道断开后所有端口映射失效。建议用 `autossh`（Linux/Mac）自动重连：

```bash
# Linux/Mac: autossh 自动重连
autossh -M 0 -o "ServerAliveInterval 30" -o "ServerAliveCountMax 3" \
  -L 8444:localhost:8444 -L 18445:localhost:18445 user@target-machine -N
```

Windows 可用 `ssh` 配合批处理循环：

```batch
:loop
ssh -L 8444:localhost:8444 -L 18445:localhost:18445 user@target-machine -N
timeout /t 5
goto loop
```

---

## 7. 安全考虑

| 风险 | 缓解措施 |
|------|---------|
| 跳板机被攻破 | `-L` 绑定到 `127.0.0.1`，不对外暴露 |
| 未授权 agent 加入 | Bridge 协议后续增加 register_token 认证 |
| SSH 密钥泄露 | 使用独立 deploy key，仅允许端口转发 |
| 中间人攻击 | SSH 自身加密，跳板机无法解密隧道内容 |

建议在 `~/.ssh/config` 中固定隧道参数：

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

然后只要 `ssh target-machine -N` 一条命令。
