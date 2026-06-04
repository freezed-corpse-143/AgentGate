/**
 * 集成测试: ConversationStore 跨进程同步
 *
 * 验证两个独立 ConversationStore 通过 Bridge 网络同步消息记录。
 * 使用新的 Bridge v2 架构 (RegistryServer + BridgeAgent)。
 *
 * 架构:
 *   Store A → onAppend → Bus A → BridgeAgent A ──┐
 *                                                  ├─ RegistryServer
 *   Store B → onAppend → Bus B → BridgeAgent B ──┘
 *     → 收到 _system.conversation.sync → ConversationSync B → Store B
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BridgeAgent, RegistryServer } from '../../src/bus/peer_bridge.js'
import { MemoryBus } from '../../src/bus/memory_bus.js'
import { ConversationStore } from '../../src/storage/conversation_store.js'
import { ConversationSync } from '../../src/storage/conversation_sync.js'
import type { MessageRecord } from '../../src/storage/conversation_store.js'
import { createServer as createNetServer } from 'net'

// ─── 辅助函数 ──────────────────────────────────────────────────

async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createNetServer()
    s.listen(0, () => {
      const port = (s.address() as any).port
      s.close(() => resolve(port))
    })
  })
}

interface SyncedProcess {
  bus: MemoryBus
  store: ConversationStore
  sync: ConversationSync
  bridge: BridgeAgent
}

async function createSyncedProcess(
  registryHost: string,
  registryPort: number,
  agentId: string,
): Promise<SyncedProcess> {
  const bus = new MemoryBus()
  const store = new ConversationStore()
  const bridge = new BridgeAgent({
    agentId,
    bus,
    registryHost,
    registryPort,
  })
  await bridge.start()
  // 等 BridgeAgent 完成注册和 peer 发现
  await new Promise(r => setTimeout(r, 500))

  const sync = new ConversationSync(bus, store)
  return { bus, store, sync, bridge }
}

function makeRecord(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    message_id: `msg_int_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    conversation_id: 'conv_sync_test',
    agent_id: 'agent-alpha',
    role: 'user',
    text: 'sync test',
    channel: 'rest',
    channel_user_id: 'tester',
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

// ─── 测试 ──────────────────────────────────────────────────────

describe('ConversationStore 跨进程同步', () => {
  let registry: RegistryServer
  let registryPort: number
  let procA: SyncedProcess
  let procB: SyncedProcess

  beforeEach(async () => {
    registryPort = await findFreePort()
    registry = new RegistryServer({ port: registryPort, host: '127.0.0.1' })
    await registry.start()

    procA = await createSyncedProcess('127.0.0.1', registryPort, 'store-A')
    procB = await createSyncedProcess('127.0.0.1', registryPort, 'store-B')
  })

  afterEach(async () => {
    procA.bridge.stop()
    procB.bridge.stop()
    await new Promise(r => setTimeout(r, 300))
    registry.stop()
  })

  it('Store A 追加消息应同步到 Store B', async () => {
    const record = makeRecord({
      message_id: `msg_a_to_b_${Date.now()}`,
      text: 'hello from A',
      agent_id: 'agent-alpha',
      conversation_id: 'conv_sync_ab',
    })

    procA.store.appendMessage(record)
    await new Promise(r => setTimeout(r, 1500))

    const convB = procB.store.getConversation('conv_sync_ab')
    expect(convB).toBeDefined()
    expect(convB!.message_count).toBeGreaterThanOrEqual(1)

    const msgsB = procB.store.getMessages('conv_sync_ab')
    expect(msgsB.some(m => m.text === 'hello from A')).toBe(true)
  })

  it('双向同步: Store B 追加也应同步到 Store A', async () => {
    const record = makeRecord({
      message_id: `msg_b_to_a_${Date.now()}`,
      text: 'hello from B',
      agent_id: 'agent-beta',
      conversation_id: 'conv_sync_ba',
    })

    procB.store.appendMessage(record)
    await new Promise(r => setTimeout(r, 1500))

    const convA = procA.store.getConversation('conv_sync_ba')
    expect(convA).toBeDefined()
    expect(convA!.message_count).toBeGreaterThanOrEqual(1)

    const msgsA = procA.store.getMessages('conv_sync_ba')
    expect(msgsA.some(m => m.text === 'hello from B')).toBe(true)
  })

  it('不应出现无限同步回路', async () => {
    const record = makeRecord({
      message_id: `msg_loop_test_${Date.now()}`,
      text: 'loop check',
      agent_id: 'agent-alpha',
      conversation_id: 'conv_sync_loop',
    })

    procA.store.appendMessage(record)
    await new Promise(r => setTimeout(r, 1500))

    // B 应至少收到 1 次（A→B）
    const convB = procB.store.getConversation('conv_sync_loop')
    expect(convB).toBeDefined()
    expect(convB!.message_count).toBeGreaterThanOrEqual(1)

    const msgsB = procB.store.getMessages('conv_sync_loop')
    expect(msgsB.some(m => m.text === 'loop check')).toBe(true)

    // 回路保护应确保不会无限循环
    const totalMsgs = msgsB.length
    expect(totalMsgs).toBeLessThanOrEqual(50)
  })

  it('多条消息应全部同步', async () => {
    const messages = ['msg-1', 'msg-2', 'msg-3']

    for (const text of messages) {
      const record = makeRecord({
        message_id: `msg_multi_${text}_${Date.now()}`,
        text,
        conversation_id: 'conv_sync_multi',
      })
      procA.store.appendMessage(record)
      await new Promise(r => setTimeout(r, 300))
    }

    await new Promise(r => setTimeout(r, 2000))

    // B 应收到全部 3 条去重后的消息
    const msgsB = procB.store.getMessages('conv_sync_multi')
    const uniqueTexts = [...new Set(msgsB.map(m => m.text))]
    expect(uniqueTexts.sort()).toEqual(messages)
  })
})
