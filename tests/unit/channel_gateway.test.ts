/**
 * 单元测试: Channel Gateway
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
import { HandshakeManager } from '../../src/auth/handshake.js'
import { MemoryBus } from '../../src/bus/memory_bus.js'
import { ChannelGateway } from '../../src/gateway/channel_gateway.js'
import type { RawMessage } from '../../src/types.js'

describe('ChannelGateway', () => {
  let store: BindingStore
  let handshake: HandshakeManager
  let bus: MemoryBus
  let gateway: ChannelGateway

  beforeEach(() => {
    Object.keys(mockData).forEach(k => delete mockData[k])
    store = new BindingStore()
    handshake = new HandshakeManager(store)
    bus = new MemoryBus()
    gateway = new ChannelGateway({ bindingStore: store, handshake, bus, defaultAgentId: 'default' })
  })

  const makeRaw = (overrides: Partial<RawMessage> = {}): RawMessage => ({
    channel: 'telegram',
    channel_user_id: 'user1',
    chat_id: 'chat1',
    text: 'hello',
    message_id: 'msg_raw_1',
    ...overrides,
  })

  it('无绑定时应返回 pair 动作', async () => {
    const raw = makeRaw()
    const result = await gateway.receive(raw)
    expect(result.action).toBe('pair')
    expect('code' in result && result.code).toMatch(/^[a-f0-9]{6}$/)
  })

  it('重复无绑定消息应返回相同的配对码', async () => {
    const raw = makeRaw()
    const r1 = await gateway.receive(raw)
    const r2 = await gateway.receive(raw)
    expect(r1.action).toBe('pair')
    expect(r2.action).toBe('pair')
    if (r1.action === 'pair' && r2.action === 'pair') {
      expect(r2.code).toBe(r1.code)
    }
  })

  it('有绑定时应返回 deliver 动作并投递到 Bus', async () => {
    // 先配对
    store.createBinding({
      channel_type: 'telegram',
      channel_user_id: 'user_bound',
      principal_id: 'p1',
      agent_id: 'agent-alpha',
      permissions: ['read', 'write'],
      status: 'active',
    })

    const raw = makeRaw({ channel_user_id: 'user_bound' })
    const result = await gateway.receive(raw)
    expect(result.action).toBe('deliver')
  })

  it('绑定被撤销时应触发重新配对', async () => {
    const b = store.createBinding({
      channel_type: 'telegram',
      channel_user_id: 'user_revoked',
      principal_id: 'p1',
      agent_id: 'a1',
      permissions: [],
      status: 'active',
    })
    store.revokeBinding(b.id)

    const raw = makeRaw({ channel_user_id: 'user_revoked' })
    const result = await gateway.receive(raw)
    // 无活跃绑定时 Gateway 触发配对
    expect(result.action).toBe('pair')
  })

  it('deliver 动作的 Envelope 应包含正确的字段', async () => {
    store.createBinding({
      channel_type: 'telegram',
      channel_user_id: 'user_deliver',
      principal_id: 'principal_x',
      agent_id: 'agent-beta',
      permissions: ['read', 'write'],
      status: 'active',
    })

    const raw = makeRaw({
      channel_user_id: 'user_deliver',
      text: '测试消息',
    })
    const result = await gateway.receive(raw)
    expect(result.action).toBe('deliver')
    if (result.action === 'deliver') {
      expect(result.envelope.agent_id).toBe('agent-beta')
      expect(result.envelope.payload.text).toBe('测试消息')
      expect(result.envelope.channel).toBe('telegram')
      expect(result.envelope.direction).toBe('inbound')
      expect(result.envelope.auth?.principal_id).toBe('principal_x')
    }
  })

  it('Bus 应收到投递的消息', async () => {
    return new Promise<void>(async (done) => {
      store.createBinding({
        channel_type: 'rest',
        channel_user_id: 'bus_user',
        principal_id: 'p1',
        agent_id: 'agent-bus',
        permissions: ['read'],
        status: 'active',
      })
      bus.subscribe('agent.agent-bus.inbound', (envelope) => {
        expect(envelope.channel_user_id).toBe('bus_user')
        expect(envelope.payload.text).toBe('bus test')
        done()
      })
      const raw = makeRaw({
        channel: 'rest',
        channel_user_id: 'bus_user',
        text: 'bus test',
      })
      await gateway.receive(raw)
    })
  })
})
