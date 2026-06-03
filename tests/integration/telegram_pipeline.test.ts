/**
 * 集成测试: Telegram + Mock API 管道
 *
 * 启动 Mock Telegram Bot API + AgentGate (带 Telegram),
 * 注入模拟消息，验证全链路。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { findFreePort, startMockApi, startAgentGate, cleanup } from './helpers.js'
import type { TestContext } from './helpers.js'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASIC_MOCK = join(__dirname, '..', 'mock_telegram_api.py')

describe('Telegram Pipeline (integration)', () => {
  const ctx = {} as TestContext & { mockUrl: string }

  beforeAll(async () => {
    ctx.mockPort = await findFreePort()
    ctx.restPort = await findFreePort()
    ctx.mockUrl = `http://localhost:${ctx.mockPort}`
    ctx.baseUrl = `http://localhost:${ctx.restPort}`

    // 启动 Mock API
    ctx.mockProcess = await startMockApi(ctx.mockPort, BASIC_MOCK)

    // 启动 AgentGate (带 Telegram)
    ctx.agentProcess = await startAgentGate(ctx.restPort, ctx.mockPort)
  }, 30000)

  afterAll(async () => {
    ctx.agentProcess?.kill('SIGTERM')
    ctx.mockProcess?.kill('SIGTERM')
  }, 10000)

  it('Mock API 应响应 getMe', async () => {
    const res = await fetch(`${ctx.mockUrl}/bot123456:TEST_MOCK_TOKEN_FAKE/getMe`, { method: 'POST' })
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.result.is_bot).toBe(true)
  })

  it('注入消息后 Mock API 应通过 getUpdates 返回', async () => {
    // 先读取已存在的消息，获取当前最大 update_id
    const drainRes = await fetch(
      `${ctx.mockUrl}/bot123456:TEST_MOCK_TOKEN_FAKE/getUpdates?offset=0&timeout=1`,
    )
    const drain = await drainRes.json()
    const nextOffset = drain.ok && drain.result.length > 0
      ? drain.result[drain.result.length - 1].update_id + 1
      : 1

    // 注入新消息
    const injectRes = await fetch(`${ctx.mockUrl}/mock/inject?text=Hello+Telegram&user_id=9999`)
    expect(injectRes.ok).toBe(true)

    // 用 nextOffset 读取
    const updatesRes = await fetch(
      `${ctx.mockUrl}/bot123456:TEST_MOCK_TOKEN_FAKE/getUpdates?offset=${nextOffset}&timeout=3`,
    )
    const body = await updatesRes.json()
    expect(body.ok).toBe(true)
    expect(body.result.length).toBeGreaterThanOrEqual(1)
    expect(body.result[0].message.text).toBe('Hello Telegram')
  })

  it('AgentGate 应该健康运行', async () => {
    const res = await fetch(`${ctx.baseUrl}/v1/health`)
    expect(res.ok).toBe(true)
  })
})
