/**
 * 单元测试: Session Router
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockData: { [path: string]: string } = {}
vi.mock('fs', () => ({
  readFileSync: (path: string) => {
    if (mockData[path]) return mockData[path]
    const err = new Error('ENOENT') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    throw err
  },
  writeFileSync: (path: string, data: string) => { mockData[path] = data },
  mkdirSync: vi.fn(),
} as any))
vi.mock('path', () => ({ join: (...p: string[]) => p.join('/'), default: { join: (...p: string[]) => p.join('/') } }))
vi.mock('os', () => ({ homedir: () => '/fake/home' }))

import { BindingStore } from '../../src/auth/binding_store.js'
import { AgentRegistry } from '../../src/agents/registry.js'
import { SessionRegistry } from '../../src/sessions/session_registry.js'
import { SessionRouter } from '../../src/sessions/router.js'
import type { Envelope } from '../../src/types.js'

function makeEnv(overrides: Partial<Envelope> = {}): Envelope {
  return {
    message_id: 'msg_001', trace_id: 'tr_001', channel: 'rest',
    channel_user_id: 'u1', agent_id: 'a1', conversation_id: 'conv_1',
    direction: 'inbound', type: 'text', payload: { text: 'hi' },
    timestamp: '2026-01-01T00:00:00Z', auth: { principal_id: 'p1', roles: ['read'] },
    ...overrides,
  }
}

describe('SessionRouter', () => {
  let bindingStore: BindingStore
  let agentRegistry: AgentRegistry
  let sessionRegistry: SessionRegistry
  let router: SessionRouter

  beforeEach(() => {
    Object.keys(mockData).forEach(k => delete mockData[k])
    bindingStore = new BindingStore()
    agentRegistry = new AgentRegistry()
    sessionRegistry = new SessionRegistry()
    router = new SessionRouter(bindingStore, agentRegistry, sessionRegistry)
  })

  it('没有绑定时应返回 null', () => {
    const env = makeEnv({ channel: 'telegram', channel_user_id: 'unknown' })
    const result = router.route(env)
    expect(result).toBeNull()
  })

  it('有绑定但 Agent 未注册时仍应返回会话', () => {
    bindingStore.createBinding({
      channel_type: 'telegram', channel_user_id: 'u1',
      principal_id: 'p1', agent_id: 'a1',
      permissions: ['read'], status: 'active',
    })
    const env = makeEnv({ channel: 'telegram', channel_user_id: 'u1' })
    const result = router.route(env)
    expect(result).not.toBeNull()
    expect(result?.agentExists).toBe(false)
    expect(result?.session.agent_id).toBe('a1')
  })

  it('有绑定且 Agent 已注册时应完整路由', () => {
    bindingStore.createBinding({
      channel_type: 'rest', channel_user_id: 'u1',
      principal_id: 'p1', agent_id: 'agent-alpha',
      permissions: ['read', 'write'], status: 'active',
    })
    agentRegistry.register({
      agent_id: 'agent-alpha', name: 'Alpha', capabilities: ['chat'],
      status: 'idle', registered_at: '2026-01-01T00:00:00Z',
    })
    const env = makeEnv({ channel: 'rest', channel_user_id: 'u1', agent_id: 'agent-alpha' })
    const result = router.route(env)
    expect(result).not.toBeNull()
    expect(result?.agentExists).toBe(true)
    expect(result?.session.channel).toBe('rest')
    expect(result?.session.message_count).toBe(1)
  })

  it('重复消息应增加会话消息计数', () => {
    bindingStore.createBinding({
      channel_type: 'telegram', channel_user_id: 'u2',
      principal_id: 'p2', agent_id: 'a1',
      permissions: ['read'], status: 'active',
    })
    const env = makeEnv({ channel: 'telegram', channel_user_id: 'u2' })
    const r1 = router.route(env)
    expect(r1?.session.message_count).toBe(1)
    const r2 = router.route(env)
    expect(r2?.session.message_count).toBe(2)
    expect(r2?.session.session_id).toBe(r1?.session.session_id)
  })
})
