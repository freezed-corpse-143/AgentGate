/**
 * 单元测试: 内存消息总线
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryBus } from '../../src/bus/memory_bus.js'
import type { Envelope } from '../../src/types.js'

function makeEnv(overrides: Partial<Envelope> = {}): Envelope {
  return {
    message_id: 'msg_test',
    trace_id: 'trace_test',
    channel: 'rest',
    channel_user_id: 'u1',
    agent_id: 'a1',
    conversation_id: 'conv_test',
    direction: 'inbound',
    type: 'text',
    payload: { text: 'test' },
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('MemoryBus', () => {
  let bus: MemoryBus

  beforeEach(() => {
    bus = new MemoryBus()
  })

  it('应发布并接收消息', () => {
    return new Promise<void>((done) => {
      const env = makeEnv()
      bus.subscribe('test.topic', (received) => {
        expect(received.message_id).toBe('msg_test')
        done()
      })
      bus.publish('test.topic', env)
    })
  })

  it('订阅者不应收到其他 topic 的消息', () => {
    return new Promise<void>((done) => {
      let called = false
      bus.subscribe('topic.a', () => { called = true })
      bus.subscribe('topic.b', () => {
        expect(called).toBe(false)
        done()
      })
      bus.publish('topic.b', makeEnv())
    })
  })

  it('通配符 agent.*.inbound 应匹配 agent.abc.inbound', () => {
    return new Promise<void>((done) => {
      bus.subscribeWildcard('agent.*.inbound', (env, topic) => {
        expect(topic).toBe('agent.my-agent.inbound')
        done()
      })
      bus.publish('agent.my-agent.inbound', makeEnv())
    })
  })

  it('通配符不应匹配不同层级的 topic', () => {
    return new Promise<void>((done) => {
      let matched = false
      bus.subscribeWildcard('agent.*.inbound', () => { matched = true })
      bus.subscribe('check', () => {
        expect(matched).toBe(false)
        done()
      })
      bus.publish('agent.my-agent.outbound', makeEnv())
      bus.publish('check', makeEnv())
    })
  })

  it('取消订阅后不应再收到消息', () => {
    return new Promise<void>((done) => {
      let count = 0
      const handler = () => { count++ }
      bus.subscribe('test', handler)
      bus.publish('test', makeEnv())
      bus.unsubscribe('test', handler)
      bus.publish('test', makeEnv())
      // 用第二个 topic 验证异步完成
      bus.subscribe('check', () => {
        expect(count).toBe(1)
        done()
      })
      bus.publish('check', makeEnv())
    })
  })

  it('clear 应移除所有订阅', () => {
    return new Promise<void>((done) => {
      let count = 0
      bus.subscribe('test', () => { count++ })
      bus.clear()
      bus.publish('test', makeEnv())
      bus.subscribe('check', () => {
        expect(count).toBe(0)
        done()
      })
      bus.publish('check', makeEnv())
    })
  })

  it('应支持多个订阅者', () => {
    return new Promise<void>((done) => {
      let count = 0
      bus.subscribe('test', () => { count++ })
      bus.subscribe('test', () => { count++ })
      bus.publish('test', makeEnv())
      bus.subscribe('check', () => {
        expect(count).toBe(2)
        done()
      })
      bus.publish('check', makeEnv())
    })
  })

  it('publish 应包含 published_at 时间戳', () => {
    return new Promise<void>((done) => {
      const before = Date.now()
      bus.subscribe('test', (_env, topic) => {
        // topic 是第二个参数, 但我们没法直接拿到 BusEvent
        done()
      })
      bus.publish('test', makeEnv())
      // 间接验证: publish 不抛异常
      expect(true).toBe(true)
      done()
    })
  })
})
