/**
 * 单元测试: Envelope 工厂、校验、序列化
 */
import { describe, it, expect } from 'vitest'
import {
  createEnvelope,
  validateEnvelope,
  serializeEnvelope,
  deserializeEnvelope,
  generateMessageId,
  generateTraceId,
  generateConversationId,
  hasRouteLoop,
  wasProcessedBy,
} from '../../src/gateway/envelope.js'

describe('generateMessageId', () => {
  it('应生成以 msg_ 开头的 ID', () => {
    const id = generateMessageId()
    expect(id).toMatch(/^msg_/)
  })

  it('应生成唯一的 ID', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateMessageId()))
    expect(ids.size).toBe(100)
  })
})

describe('generateTraceId', () => {
  it('应生成以 trace_ 开头的 ID', () => {
    const id = generateTraceId()
    expect(id).toMatch(/^trace_/)
  })
})

describe('generateConversationId', () => {
  it('应为相同信道+用户生成一致的 ID', () => {
    const a = generateConversationId('telegram', 'user123')
    const b = generateConversationId('telegram', 'user123')
    expect(a).toBe(b)
  })

  it('应为不同用户生成不同的 ID', () => {
    const a = generateConversationId('telegram', 'user1')
    const b = generateConversationId('telegram', 'user2')
    expect(a).not.toBe(b)
  })

  it('应包含日期和 md5 hash', () => {
    const id = generateConversationId('rest', 'test')
    expect(id).toMatch(/^conv_\d{8}_[a-f0-9]{8}$/)
  })
})

describe('createEnvelope', () => {
  const baseOpts = {
    channel: 'telegram' as const,
    channel_user_id: '12345',
    agent_id: 'agent1',
    direction: 'inbound' as const,
    type: 'text' as const,
    payload: { text: 'hello' },
  }

  it('应创建完整的 Envelope', () => {
    const env = createEnvelope(baseOpts)
    expect(env.message_id).toMatch(/^msg_/)
    expect(env.trace_id).toMatch(/^trace_/)
    expect(env.channel).toBe('telegram')
    expect(env.channel_user_id).toBe('12345')
    expect(env.agent_id).toBe('agent1')
    expect(env.direction).toBe('inbound')
    expect(env.type).toBe('text')
    expect(env.payload.text).toBe('hello')
    expect(env.timestamp).toBeTruthy()
  })

  it('应使用外部 trace_id 而非自动生成', () => {
    const env = createEnvelope({ ...baseOpts, trace_id: 'trace_custom' })
    expect(env.trace_id).toBe('trace_custom')
  })

  it('应使用外部 conversation_id', () => {
    const env = createEnvelope({ ...baseOpts, conversation_id: 'conv_custom' })
    expect(env.conversation_id).toBe('conv_custom')
  })

  it('应携带 auth 信息', () => {
    const env = createEnvelope({
      ...baseOpts,
      auth: { principal_id: 'user_p', roles: ['admin'] },
    })
    expect(env.auth?.principal_id).toBe('user_p')
    expect(env.auth?.roles).toEqual(['admin'])
  })

  it('应支持 target_agent_id 跨 Agent 路由', () => {
    const env = createEnvelope({
      ...baseOpts,
      target_agent_id: 'agent-beta',
    })
    expect(env.target_agent_id).toBe('agent-beta')
  })

  it('route_history 应保留传入的值', () => {
    const env = createEnvelope({
      ...baseOpts,
      agent_id: 'agent-alpha',
      route_history: ['agent-beta'],
    })
    expect(env.route_history).toEqual(['agent-beta'])
  })

  it('route_history 不传入时应为空数组', () => {
    const env = createEnvelope({
      ...baseOpts,
      agent_id: 'agent-alpha',
    })
    expect(env.route_history).toEqual([])
  })
})

describe('hasRouteLoop / wasProcessedBy', () => {
  it('最多 5 跳后应检测到循环', () => {
    const env = createEnvelope({
      channel: 'rest', channel_user_id: 'u1', agent_id: 'a1',
      direction: 'inbound', type: 'text', payload: { text: 'test' },
      route_history: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'], // 6 agents
    })
    expect(hasRouteLoop(env)).toBe(true)
  })

  it('4 跳不应检测为循环', () => {
    const env = createEnvelope({
      channel: 'rest', channel_user_id: 'u1', agent_id: 'a1',
      direction: 'inbound', type: 'text', payload: { text: 'test' },
      route_history: ['a1', 'b2', 'c3', 'd4'],
    })
    expect(hasRouteLoop(env)).toBe(false)
  })

  it('wasProcessedBy 应正确检测', () => {
    const env = createEnvelope({
      channel: 'rest', channel_user_id: 'u1', agent_id: 'a1',
      direction: 'inbound', type: 'text', payload: { text: 'test' },
      route_history: ['alpha', 'beta'],
    })
    expect(wasProcessedBy(env, 'alpha')).toBe(true)
    expect(wasProcessedBy(env, 'gamma')).toBe(false)
  })
})

describe('validateEnvelope', () => {
  const validEnvelope = {
    message_id: 'msg_001',
    trace_id: 'trace_001',
    channel: 'telegram' as const,
    channel_user_id: 'u1',
    agent_id: 'a1',
    workspace_id: 'w1',
    conversation_id: 'conv_001',
    direction: 'inbound' as const,
    type: 'text' as const,
    payload: { text: 'hi' },
    auth: { principal_id: 'p1', roles: ['read'] },
    timestamp: '2026-01-01T00:00:00Z',
  }

  it('应接受有效 Envelope', () => {
    const result = validateEnvelope(validEnvelope)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('应拒绝缺失必填字段', () => {
    const result = validateEnvelope({ ...validEnvelope, message_id: '' })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('message_id')
  })

  it('应拒绝非法 channel', () => {
    const result = validateEnvelope({
      ...validEnvelope,
      channel: 'invalid' as any,
    })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('channel')
  })

  it('应拒绝非法 direction', () => {
    const result = validateEnvelope({
      ...validEnvelope,
      direction: 'sideways' as any,
    })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('direction')
  })

  it('应拒绝非法 type', () => {
    const result = validateEnvelope({
      ...validEnvelope,
      type: 'invalid_type' as any,
    })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('type')
  })
})

describe('serializeEnvelope / deserializeEnvelope', () => {
  const envelope = {
    message_id: 'msg_001',
    trace_id: 'trace_001',
    channel: 'rest' as const,
    channel_user_id: 'u1',
    agent_id: 'a1',
    conversation_id: 'conv_001',
    direction: 'outbound' as const,
    type: 'agent_response' as const,
    payload: { text: 'reply' },
    timestamp: '2026-01-01T00:00:00Z',
  }

  it('应序列化并反序列化为相同对象', () => {
    const json = serializeEnvelope(envelope)
    const parsed = deserializeEnvelope(json)
    expect(parsed).toEqual(envelope)
  })

  it('序列化结果应为合法 JSON', () => {
    const json = serializeEnvelope(envelope)
    expect(() => JSON.parse(json)).not.toThrow()
  })
})
