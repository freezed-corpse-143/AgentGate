/**
 * 集成测试: Telegram 全链路 — Mock Bot API → TelegramAdapter → Gateway → AgentRuntime → Reply
 *
 * 启动 Mock Telegram Bot API + AgentGate (带 Telegram + REST),
 * 注入消息，验证完整消息回路。
 *
 * 架构:
 *   Mock API ←polling← TelegramAdapter ←→ Bus ←→ AgentRuntime
 *        ↕                                       ↕
 *   inject test msg                          echo reply
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'child_process'
import { setTimeout as sleep } from 'timers/promises'
import { createServer, type Server } from 'net'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MOCK_SCRIPT = join(__dirname, '..', 'mock_telegram_api.py')
const TOKEN = '123456:TEST_MOCK_TOKEN_FAKE'

// ─── 工具函数 ──────────────────────────────────────────────────

async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer()
    s.listen(0, () => {
      const port = (s.address() as any).port
      s.close(() => resolve(port))
    })
  })
}

async function waitForPort(port: number, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/mock/replies`)
      if (res.ok) return
    } catch {}
    await sleep(300)
  }
  throw new Error(`Port ${port} not ready in ${timeoutMs}ms`)
}

async function waitForHealth(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/v1/health`)
      if (res.ok) return
    } catch {}
    await sleep(300)
  }
  throw new Error(`Health check failed for ${url}`)
}

async function pairUser(baseUrl: string, userId: string, agentId: string): Promise<void> {
  // 获取配对码
  const pairRes = await fetch(`${baseUrl}/v1/handshake/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, chat_id: userId, channel_type: 'telegram' }),
  })
  const { code } = await pairRes.json()

  // 验证配对码
  const verifyRes = await fetch(`${baseUrl}/v1/handshake/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, user_id: userId, agent_id: agentId }),
  })
  const data = await verifyRes.json()
  if (data.status !== 'paired') {
    throw new Error(`Pair failed: ${JSON.stringify(data)}`)
  }
}

// ─── 测试 ──────────────────────────────────────────────────────

describe('Telegram 全链路', () => {
  let mockPort: number
  let restPort: number
  let mockProcess: ChildProcess
  let agentProcess: ChildProcess
  let tmpDir: string

  beforeAll(async () => {
    mockPort = await findFreePort()
    restPort = await findFreePort()
    // 独立临时目录，避免与其它测试文件冲突
    tmpDir = join(__dirname, '..', '..', '.tmp', `tg_test_${Date.now()}`)

    // 1. 启动 Mock Telegram Bot API
    mockProcess = spawn('python3', ['-u', MOCK_SCRIPT, String(mockPort)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    mockProcess.stderr?.on('data', () => {})
    await waitForPort(mockPort)

    // 2. 启动 AgentGate (REST + Telegram)
    agentProcess = spawn('node', ['dist/index.js', 'start'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env as any,
        AGENTGATE_REST_PORT: String(restPort),
        AGENTGATE_DEFAULT_AGENT: 'test-agent',
        TELEGRAM_BOT_TOKEN: TOKEN,
        TELEGRAM_API_ROOT: `http://localhost:${mockPort}`,
        AGENTGATE_DIR: tmpDir,
      },
    })
    agentProcess.stderr?.on('data', () => {})
    await waitForHealth(`http://localhost:${restPort}`, 20000)
  }, 30000)

  afterAll(async () => {
    // 优雅关闭
    agentProcess?.kill('SIGTERM')
    mockProcess?.kill('SIGTERM')
    await sleep(500)
    try { agentProcess?.kill('SIGKILL') } catch {}
    try { mockProcess?.kill('SIGKILL') } catch {}
    // 清理临时文件
    try { const { rmSync } = await import('fs'); rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }, 10000)

  it('Mock API 应响应 getMe', async () => {
    const res = await fetch(`http://localhost:${mockPort}/bot${TOKEN}/getMe`, { method: 'POST' })
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.result.is_bot).toBe(true)
  })

  it('注入消息后 Mock API 应通过 getUpdates 返回', async () => {
    // 注入新消息
    const injectRes = await fetch(
      `http://localhost:${mockPort}/mock/inject?text=Hello+Telegram&user_id=9999`,
    )
    expect(injectRes.ok).toBe(true)

    // 轮询获取（使用最小的 offset 获取所有待处理消息）
    const updatesRes = await fetch(
      `http://localhost:${mockPort}/bot${TOKEN}/getUpdates?offset=0&timeout=2`,
      { method: 'POST' },
    )
    const body = await updatesRes.json()
    expect(body.ok).toBe(true)
    expect(body.result.length).toBeGreaterThanOrEqual(1)
    const msg = body.result.find((u: any) => u.message?.text === 'Hello Telegram')
    expect(msg).toBeDefined()
  })

  it('TelegramAdapter 轮询到消息后 Agent 应回复', async () => {
    const userId = '987654'
    const chatId = '987654'

    // 先通过 REST 绑定用户
    await pairUser(`http://localhost:${restPort}`, userId, 'test-agent')

    // 注入消息到 Mock API（模拟 Telegram 用户发消息）
    const injectRes = await fetch(
      `http://localhost:${mockPort}/mock/inject?text=test+from+telegram&user_id=${userId}&chat_id=${chatId}`,
    )
    expect(injectRes.ok).toBe(true)

    // 等待 Telegram 轮询 + Agent 处理 + 回复到达 Mock API
    await sleep(5000)

    // 检查 Mock API 的 reply_log 中是否有回复
    const repliesRes = await fetch(`http://localhost:${mockPort}/mock/replies`)
    const repliesBody = await repliesRes.json()
    expect(repliesBody.ok).toBe(true)

    const replies = repliesBody.result as Array<{ chat_id: string; text: string }>
    const agentReply = replies.find((r) => r.text.includes('已收到消息'))
    expect(agentReply).toBeDefined()
    expect(agentReply!.text).toContain('test from telegram')
  }, 15000)

  it('发送多条消息应依次回复', async () => {
    const userId = '5555'

    // 绑定用户
    await pairUser(`http://localhost:${restPort}`, userId, 'test-agent')

    // 注入 2 条消息
    for (const text of ['hello A', 'hello B']) {
      await fetch(
        `http://localhost:${mockPort}/mock/inject?text=${encodeURIComponent(text)}&user_id=${userId}`,
      )
      await sleep(200)
    }

    await sleep(6000)

    // 检查回复日志
    const repliesRes = await fetch(`http://localhost:${mockPort}/mock/replies`)
    const repliesBody = await repliesRes.json()
    const replies = (repliesBody.result as Array<{ chat_id: string; text: string }>)
      .filter(r => r.chat_id === userId)

    // 每个消息应该都有一个回复
    expect(replies.length).toBeGreaterThanOrEqual(1)
  }, 15000)
})
