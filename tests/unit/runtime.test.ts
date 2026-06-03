/**
 * 单元测试: AgentRuntime — 跨 Agent 消息路由
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── fs mock ──────────────────────────────────────────────────
const mockData: { [path: string]: string } = {}
vi.mock('fs', () => ({
  readFileSync: (path: string) => {
    if (mockData[path]) return mockData[path]
    const err = new Error('ENOENT') as NodeJS.ErrnoException
    err.code = 'ENOENT'; throw err
  },
  writeFileSync: (path: string, data: string) => { mockData[path] = data },
  mkdirSync: vi.fn(),
} as any))
vi.mock('path', () => ({ join: (...p: string[]) => p.join('/'), default: { join: (...p: string[]) => p.join('/') } }))
vi.mock('os', () => ({ homedir: () => '/fake/home' }))

import { MemoryBus } from '../../src/bus/memory_bus.js'
import { BindingStore } from '../../src/auth/binding_store.js'
import { AgentRegistry } from '../../src/agents/registry.js'
import { SessionRegistry } from '../../src/sessions/session_registry.js'
import { SessionRouter } from '../../src/sessions/router.js'
import { AgentRuntime } from '../../src/agents/runtime.js'
import { createEnvelope } from '../../src/gateway/envelope.js'
import type { Envelope } from '../../src/types.js'

function makeInbound(overrides: Partial<Envelope> = {}): Envelope {
  return {
    message_id: 'msg_in_1', trace_id: 'tr_1', channel: 'rest',
    channel_user_id: 'user_a', agent_id: 'agent-alpha',
    conversation_id: 'conv_1', direction: 'inbound', type: 'text',
    payload: { text: 'hello' }, timestamp: '2026-01-01T00:00:00Z',
    auth: { principal_id: 'p1', roles: ['read'] },
    ...overrides,
  }
}

describe('AgentRuntime — 跨 Agent 路由', () => {
  let bus: MemoryBus
  let store: BindingStore
  let agentRegistry: AgentRegistry
  let sessionRegistry: SessionRegistry
  let router: SessionRouter
  let runtime: AgentRuntime

  beforeEach(() => {
    Object.keys(mockData).forEach(k => delete mockData[k])
    bus = new MemoryBus()
    store = new BindingStore()
    agentRegistry = new AgentRegistry()
    sessionRegistry = new SessionRegistry()
    router = new SessionRouter(store, agentRegistry, sessionRegistry)
    runtime = new AgentRuntime(bus, agentRegistry, router)

    // 注册两个 Agent
    agentRegistry.register({
      agent_id: 'agent-alpha', name: 'Alpha', capabilities: ['chat'],
      status: 'idle', registered_at: '2026-01-01T00:00:00Z',
    })
    agentRegistry.register({
      agent_id: 'agent-beta', name: 'Beta', capabilities: ['chat'],
      status: 'idle', registered_at: '2026-01-01T00:00:00Z',
    })

    // 创建绑定
    store.createBinding({
      channel_type: 'rest', channel_user_id: 'user_a',
      principal_id: 'p1', agent_id: 'agent-alpha',
      permissions: ['read'], status: 'active',
    })
    store.createBinding({
      channel_type: 'rest', channel_user_id: 'user_b',
      principal_id: 'p2', agent_id: 'agent-beta',
      permissions: ['read'], status: 'active',
    })
  })

  it('字符串回复应发布到 outbound topic', () => {
    return new Promise<void>((done) => {
      runtime.setHandler('agent-alpha', async () => 'simple reply')
      runtime.start()

      bus.subscribe('agent.agent-alpha.outbound', (env) => {
        expect(env.payload.text).toBe('simple reply')
        expect(env.target_agent_id).toBeUndefined()
        done()
      })

      bus.publish('agent.agent-alpha.inbound', makeInbound())
    })
  })

  it('带 target_agent_id 的回复应路由到目标 Agent 的 inbound', () => {
    return new Promise<void>((done) => {
      runtime.setHandler('agent-alpha', async () => ({
        text: '转发到 Beta',
        target_agent_id: 'agent-beta',
      }))
      runtime.start()

      bus.subscribe('agent.agent-beta.inbound', (env) => {
        expect(env.payload.text).toBe('转发到 Beta')
        expect(env.agent_id).toBe('agent-beta') // 路由后 agent_id 更新为目标
        expect(env.target_agent_id).toBe('agent-beta')
        // route_history 应包含 alpha
        expect(env.route_history).toContain('agent-alpha')
        done()
      })

      bus.publish('agent.agent-alpha.inbound', makeInbound())
    })
  })

  it('跨 Agent 消息不应发布到 outbound topic', () => {
    return new Promise<void>((done) => {
      let outboundCalled = false
      runtime.setHandler('agent-alpha', async () => ({
        text: '只发 Beta',
        target_agent_id: 'agent-beta',
      }))
      runtime.start()

      bus.subscribe('agent.agent-alpha.outbound', () => { outboundCalled = true })
      bus.subscribe('agent.agent-beta.inbound', () => {
        // 给 outbound 一点时间触发
        setTimeout(() => {
          expect(outboundCalled).toBe(false)
          done()
        }, 50)
      })

      bus.publish('agent.agent-alpha.inbound', makeInbound())
    })
  })

  it('循环检测应丢弃超跳消息', () => {
    return new Promise<void>((done) => {
      let betaCalled = false
      runtime.setHandler('agent-alpha', async () => ({
        text: 'to beta',
        target_agent_id: 'agent-beta',
      }))
      runtime.start()

      bus.subscribe('agent.agent-beta.inbound', () => { betaCalled = true })

      // 发布一个已超过 5 跳的消息
      bus.subscribe('loop-check', () => {
        expect(betaCalled).toBe(false)
        done()
      })

      bus.publish('agent.agent-alpha.inbound', makeInbound({
        route_history: ['a', 'b', 'c', 'd', 'e', 'f'], // 6 跳
      }))
      bus.publish('loop-check', makeInbound({ message_id: 'check' }))
    })
  })

  it('已处理检测应丢弃重复消息', () => {
    return new Promise<void>((done) => {
      let handlerCallCount = 0
      runtime.setHandler('agent-alpha', async () => {
        handlerCallCount++
        return 'reply'
      })
      runtime.start()

      // 发布一条 route_history 中已含 agent-alpha 的消息
      bus.publish('agent.agent-alpha.inbound', makeInbound({
        route_history: ['agent-alpha'],
      }))

      // 验证 outbound 没有被调用 (handler 被跳过)
      bus.subscribe('agent.agent-alpha.outbound', () => {
        // 不应该到达这里
        expect(true).toBe(false)
      })

      // 用延迟验证 handler 未被调用
      setTimeout(() => {
        expect(handlerCallCount).toBe(0)
        done()
      }, 100)
    })
  })

  it('多跳路由应正常传递', () => {
    return new Promise<void>((done) => {
      // Alpha → Beta → Gamma
      agentRegistry.register({
        agent_id: 'agent-gamma', name: 'Gamma', capabilities: ['chat'],
        status: 'idle', registered_at: '2026-01-01T00:00:00Z',
      })

      runtime.setHandler('agent-alpha', async () => ({
        text: 'alpha says hi',
        target_agent_id: 'agent-beta',
      }))
      runtime.setHandler('agent-beta', async (env) => {
        expect(env.payload.text).toBe('alpha says hi')
        expect(env.route_history).toContain('agent-alpha')
        return { text: 'beta forwarding', target_agent_id: 'agent-gamma' }
      })
      runtime.start()

      // 监听 gamma 的 inbound
      bus.subscribe('agent.agent-gamma.inbound', (env) => {
        expect(env.payload.text).toBe('beta forwarding')
        expect(env.route_history).toEqual(['agent-alpha', 'agent-beta'])
        expect(env.route_history).not.toContain('agent-gamma')
        done()
      })

      bus.publish('agent.agent-alpha.inbound', makeInbound())
    })
  })
})
