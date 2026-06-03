/**
 * 集成测试: REST 管道 + 对话存储
 *
 * 启动 Mock API + AgentGate，发消息验证全链路。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { findFreePort, startMockApi, startAgentGate, cleanup, pairUser, sendMessage } from './helpers.js'
import type { TestContext } from './helpers.js'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('REST Pipeline (integration)', () => {
  const ctx = {} as TestContext

  beforeAll(async () => {
    ctx.restPort = await findFreePort()
    ctx.baseUrl = `http://localhost:${ctx.restPort}`
    ctx.agentProcess = await startAgentGate(ctx.restPort)
  }, 30000)

  afterAll(async () => {
    ctx.agentProcess?.kill('SIGTERM')
  }, 10000)

  it('健康检查应返回 ok', async () => {
    const res = await fetch(`${ctx.baseUrl}/v1/health`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  it('应成功配对用户', async () => {
    await pairUser(ctx.baseUrl, 'integration-test-user')
    // 无异常即成功
    expect(true).toBe(true)
  })

  it('应接收消息并产生回复', async () => {
    await pairUser(ctx.baseUrl, 'msg-test-user')
    const result = await sendMessage(ctx.baseUrl, 'msg-test-user', 'Hello Integration!')
    expect(result.status).toBe('received')
    expect(result.message_id).toBeTruthy()

    // 等待 Agent 处理
    await new Promise(r => setTimeout(r, 500))

    // 验证对话已记录
    const convRes = await fetch(`${ctx.baseUrl}/v1/conversations`)
    const convs = await convRes.json()
    expect(convs.length).toBeGreaterThanOrEqual(1)

    // 找到我们的对话
    const ourConv = convs.find((c: any) => c.channel_user_id === 'msg-test-user')
    expect(ourConv).toBeDefined()
    expect(ourConv.message_count).toBeGreaterThanOrEqual(1)
  })

  it('对话消息应包含 user 和 agent 两条记录', async () => {
    await pairUser(ctx.baseUrl, 'two-msg-user')
    await sendMessage(ctx.baseUrl, 'two-msg-user', 'Check for two messages')

    await new Promise(r => setTimeout(r, 500))

    const convRes = await fetch(`${ctx.baseUrl}/v1/conversations`)
    const convs = await convRes.json()
    const ourConv = convs.find((c: any) => c.channel_user_id === 'two-msg-user')
    expect(ourConv).toBeDefined()

    // 查消息
    const msgRes = await fetch(`${ctx.baseUrl}/v1/conversations/${ourConv.conversation_id}/messages?limit=5`)
    const { messages } = await msgRes.json()
    expect(messages.length).toBeGreaterThanOrEqual(2)

    const roles = messages.map((m: any) => m.role)
    expect(roles).toContain('user')
    expect(roles).toContain('agent')

    // 验证消息内容
    const userMsg = messages.find((m: any) => m.role === 'user')
    expect(userMsg.text).toBe('Check for two messages')
  })
})
