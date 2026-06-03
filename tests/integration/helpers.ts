/**
 * 集成测试助手 — 管理 Mock API + AgentGate 子进程生命周期
 */
import { spawn, type ChildProcess } from 'child_process'
import { setTimeout as sleep } from 'timers/promises'
import { createServer, type Server } from 'net'

/** 找可用端口 */
export async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer()
    s.listen(0, () => {
      const port = (s.address() as any).port
      s.close(() => resolve(port))
    })
  })
}

export interface TestContext {
  mockPort: number
  restPort: number
  mockProcess: ChildProcess
  agentProcess: ChildProcess
  baseUrl: string
}

/** 启动 Mock Telegram Bot API (等待端口就绪) */
export async function startMockApi(port: number, scriptPath: string): Promise<ChildProcess> {
  const proc = spawn('python3', ['-u', scriptPath, String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  proc.stderr?.on('data', () => {})
  // 等待端口就绪
  // 消费 stdout 并检查错误
  const stdout: Buffer[] = []
  proc.stdout?.on('data', (d: Buffer) => stdout.push(d))
  const stderr: Buffer[] = []
  proc.stderr?.on('data', (d: Buffer) => stderr.push(d))

  for (let i = 0; i < 30; i++) {
    await sleep(500)
    try {
      const res = await fetch(`http://localhost:${port}/mock/inject?text=ping`)
      if (res.ok) return proc
    } catch {}
    // 检查进程是否已退出
    if (proc.exitCode !== null) {
      const out = Buffer.concat(stdout).toString()
      const err = Buffer.concat(stderr).toString()
      throw new Error(`Mock API exited early (code=${proc.exitCode}): ${err || out || '(no output)'}`)
    }
  }
  throw new Error(`Mock API did not start on port ${port} in time`)
}

/** 启动 AgentGate 服务 */
export async function startAgentGate(
  restPort: number,
  mockApiPort?: number,
): Promise<ChildProcess> {
  const env: Record<string, string> = {
    ...process.env as any,
    AGENTGATE_REST_PORT: String(restPort),
    AGENTGATE_DEFAULT_AGENT: 'test-agent',
  }
  if (mockApiPort) {
    env.TELEGRAM_BOT_TOKEN = '123456:TEST_MOCK_TOKEN_FAKE'
    env.TELEGRAM_API_ROOT = `http://localhost:${mockApiPort}`
  }

  const proc = spawn('node', ['dist/index.js', 'start'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  })
  proc.stderr?.on('data', () => {})

  // 等待就绪
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    try {
      const res = await fetch(`http://localhost:${restPort}/v1/health`)
      if (res.ok) return proc
    } catch {}
  }
  throw new Error('AgentGate did not start in time')
}

/** 清理测试环境 */
export async function cleanup(ctx: TestContext): Promise<void> {
  ctx.agentProcess.kill('SIGTERM')
  ctx.mockProcess.kill('SIGTERM')
  await sleep(500)
  try { ctx.agentProcess.kill('SIGKILL') } catch {}
  try { ctx.mockProcess.kill('SIGKILL') } catch {}
}

/** 建立 REST 绑定 */
export async function pairUser(baseUrl: string, userId: string): Promise<void> {
  const pairRes = await fetch(`${baseUrl}/v1/handshake/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, chat_id: 'default' }),
  })
  const { code } = await pairRes.json()
  const verifyRes = await fetch(`${baseUrl}/v1/handshake/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, user_id: userId, agent_id: 'test-agent' }),
  })
  const data = await verifyRes.json()
  if (data.status !== 'paired') throw new Error(`Pair failed: ${JSON.stringify(data)}`)
}

/** 发送 REST 消息 */
export async function sendMessage(baseUrl: string, userId: string, text: string): Promise<any> {
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, text }),
  })
  return res.json()
}
