/**
 * 单元测试: Handshake Manager
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HandshakeManager } from '../../src/auth/handshake.js'
import { BindingStore } from '../../src/auth/binding_store.js'

// 模拟 fs (同 binding_store.test.ts)
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

vi.mock('path', () => ({
  join: (...parts: string[]) => parts.join('/'),
  default: { join: (...parts: string[]) => parts.join('/') },
}))

vi.mock('os', () => ({
  homedir: () => '/fake/home',
}))

describe('HandshakeManager', () => {
  let store: BindingStore
  let handshake: HandshakeManager

  beforeEach(() => {
    Object.keys(mockData).forEach(k => delete mockData[k])
    store = new BindingStore()
    handshake = new HandshakeManager(store)
  })

  it('createPairing 应返回 6 字符 hex 码', () => {
    const code = handshake.createPairing('telegram', 'user1', 'chat1')
    expect(code).toMatch(/^[a-f0-9]{6}$/)
  })

  it('相同的 user+channel 应返回相同配对码', () => {
    const code1 = handshake.createPairing('telegram', 'user1', 'chat1')
    const code2 = handshake.createPairing('telegram', 'user1', 'chat1')
    expect(code1).toBe(code2)
  })

  it('不同的 user 应返回不同配对码', () => {
    const code1 = handshake.createPairing('telegram', 'user1', 'chat1')
    const code2 = handshake.createPairing('telegram', 'user2', 'chat2')
    expect(code1).not.toBe(code2)
  })

  it('getPending 应返回待配对记录', () => {
    handshake.createPairing('rest', 'new_user', 'default')
    const pending = handshake.getPending('rest', 'new_user')
    expect(pending).toBeDefined()
    expect(pending?.code).toMatch(/^[a-f0-9]{6}$/)
    expect(pending?.channel_type).toBe('rest')
  })

  it('verifyPairing 应创建绑定', () => {
    const code = handshake.createPairing('telegram', 'user_v', 'chat_v')
    const binding = handshake.verifyPairing(code, 'agent-alpha', 'principal1')
    expect(binding).toBeDefined()
    expect(binding?.agent_id).toBe('agent-alpha')
    expect(binding?.channel_user_id).toBe('user_v')

    // 验证绑定已持久化
    const found = store.getBinding('telegram', 'user_v')
    expect(found).toBeDefined()
  })

  it('验证后配对码应失效', () => {
    const code = handshake.createPairing('telegram', 'user_x', 'chat_x')
    handshake.verifyPairing(code, 'agent1', 'p1')
    // 第二次验证应失败
    const again = handshake.verifyPairing(code, 'agent1', 'p1')
    expect(again).toBeNull()
  })

  it('无效配对码应返回 null', () => {
    const result = handshake.verifyPairing('abcdef', 'agent1', 'p1')
    expect(result).toBeNull()
  })

  it('denyPairing 应移除待配对', () => {
    const code = handshake.createPairing('telegram', 'user_d', 'chat_d')
    expect(handshake.denyPairing(code)).toBe(true)
    expect(handshake.getPending('telegram', 'user_d')).toBeUndefined()
  })

  it('denyPairing 无效码应返回 false', () => {
    expect(handshake.denyPairing('xxxxxx')).toBe(false)
  })

  it('pruneExpired 应清理过期配对码', () => {
    // 创建一个待配对
    handshake.createPairing('telegram', 'user_expire', 'chat_e')

    // 手动篡改过期时间
    const pending = handshake.getPending('telegram', 'user_expire')!
    pending.expires_at = Date.now() - 1000 // 已过期

    const pruned = handshake.pruneExpired()
    expect(pruned).toBe(1)
    expect(handshake.getPending('telegram', 'user_expire')).toBeUndefined()
  })
})
