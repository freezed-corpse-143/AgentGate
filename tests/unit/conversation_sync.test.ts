/**
 * 单元测试: ConversationSync
 *
 * 验证 ConversationSync 单元行为:
 * 1. 本地 append → 发布到 bus 的 _system.conversation.sync topic
 * 2. 接收 bus 的 _system.conversation.sync → 追加到 ConversationStore
 * 3. 回路避免: 远端同步不会再次广播
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryBus } from '../../src/bus/memory_bus.js'
import { ConversationStore } from '../../src/storage/conversation_store.js'
import { ConversationSync } from '../../src/storage/conversation_sync.js'
import type { MessageRecord } from '../../src/storage/conversation_store.js'

function makeRecord(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    message_id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    conversation_id: 'conv_test',
    agent_id: 'agent-alpha',
    role: 'user',
    text: 'test message',
    channel: 'rest',
    channel_user_id: 'tester',
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

describe('ConversationSync', () => {
  let bus: MemoryBus
  let store: ConversationStore
  let sync: ConversationSync

  beforeEach(() => {
    bus = new MemoryBus()
    store = new ConversationStore()
    sync = new ConversationSync(bus, store)
  })

  it('本地 append 应发布到 _system.conversation.sync', () => {
    return new Promise<void>((done) => {
      const record = makeRecord({ text: 'sync test' })

      bus.subscribe('_system.conversation.sync', (envelope) => {
        const data = envelope.payload?.data
        expect(data?._sync).toBe(true)
        expect(data?.text).toBe('sync test')
        expect(data?.agent_id).toBe('agent-alpha')
        done()
      })

      store.appendMessage(record)
    })
  })

  it('bus 收到 _system.conversation.sync 应追加到 store', async () => {
    // 模拟远端同步消息
    bus.publish('_system.conversation.sync', {
      message_id: 'sync_msg_1',
      trace_id: 'trace_1',
      channel: 'rest',
      channel_user_id: 'remote',
      agent_id: 'agent-beta',
      conversation_id: 'conv_remote',
      direction: 'inbound',
      type: 'system_alert',
      payload: {
        text: 'remote message',
        data: {
          _sync: true,
          message_id: 'sync_msg_1',
          conversation_id: 'conv_remote',
          agent_id: 'agent-beta',
          role: 'agent',
          text: 'remote message',
          channel: 'rest',
          channel_user_id: 'remote',
          timestamp: new Date().toISOString(),
        },
      },
      timestamp: new Date().toISOString(),
    })

    // 给 handleRemoteSync 时间处理（同步的 EventEmitter + 异步文件写入）
    await new Promise(r => setTimeout(r, 200))

    const conv = store.getConversation('conv_remote')
    expect(conv).toBeDefined()
    expect(conv!.message_count).toBeGreaterThanOrEqual(1)

    const msgs = store.getMessages('conv_remote')
    expect(msgs.some(m => m.text === 'remote message')).toBe(true)
    expect(msgs.some(m => m.agent_id === 'agent-beta')).toBe(true)
  })

  it('回路避免: 远端同步不应再次广播', async () => {
    let publishCount = 0

    bus.subscribe('_system.conversation.sync', () => {
      publishCount++
    })

    // 模拟远端同步
    bus.publish('_system.conversation.sync', {
      message_id: 'sync_loop',
      trace_id: 'trace_1',
      channel: 'rest', channel_user_id: 'remote',
      agent_id: 'agent-beta',
      conversation_id: 'conv_loop',
      direction: 'inbound', type: 'system_alert',
      payload: {
        text: 'loop test',
        data: {
          _sync: true,
          message_id: 'sync_loop',
          conversation_id: 'conv_loop',
          agent_id: 'agent-beta',
          role: 'agent', text: 'loop test',
          channel: 'rest', channel_user_id: 'remote',
          timestamp: new Date().toISOString(),
        },
      },
      timestamp: new Date().toISOString(),
    })

    // 给足够时间处理回路
    await new Promise(r => setTimeout(r, 300))

    // 应该只有 1 次发布（远端发来的），不会因为本地 append 再次发布
    expect(publishCount).toBe(1)
  })

  it('stop() 应停止同步', () => {
    return new Promise<void>((done) => {
      sync.stop()

      let count = 0
      bus.subscribe('_system.conversation.sync', () => { count++ })

      store.appendMessage(makeRecord({ text: 'after stop' }))

      setTimeout(() => {
        expect(count).toBe(0)
        done()
      }, 200)
    })
  })
})
