/**
 * 单元测试: Session Registry
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

vi.mock('path', () => ({
  join: (...parts: string[]) => parts.join('/'),
  default: { join: (...parts: string[]) => parts.join('/') },
}))

vi.mock('os', () => ({
  homedir: () => '/fake/home',
}))

import { SessionRegistry } from '../../src/sessions/session_registry.js'

describe('SessionRegistry', () => {
  let registry: SessionRegistry

  beforeEach(() => {
    Object.keys(mockData).forEach(k => delete mockData[k])
    registry = new SessionRegistry()
  })

  it('getOrCreate 应创建新会话', () => {
    const session = registry.getOrCreate('agent1', 'telegram', 'user1')
    expect(session.session_id).toMatch(/^sess_/)
    expect(session.agent_id).toBe('agent1')
    expect(session.channel).toBe('telegram')
    expect(session.channel_user_id).toBe('user1')
    expect(session.message_count).toBe(1)
  })

  it('重复调用应返回相同会话且消息计数递增', () => {
    const a = registry.getOrCreate('agent1', 'telegram', 'user1')
    expect(a.message_count).toBe(1)
    const b = registry.getOrCreate('agent1', 'telegram', 'user1')
    expect(a.session_id).toBe(b.session_id)
    expect(b.message_count).toBe(2)
    const c = registry.getOrCreate('agent1', 'telegram', 'user1')
    expect(c.message_count).toBe(3)
  })

  it('不同 agent 应创建不同会话', () => {
    const a = registry.getOrCreate('agent-alpha', 'telegram', 'user1')
    const b = registry.getOrCreate('agent-beta', 'telegram', 'user1')
    expect(a.session_id).not.toBe(b.session_id)
  })

  it('getById 应获取会话', () => {
    const session = registry.getOrCreate('agent1', 'rest', 'u1')
    const found = registry.getById(session.session_id)
    expect(found).toBeDefined()
    expect(found?.agent_id).toBe('agent1')
  })

  it('closeSession 应移除会话', () => {
    const session = registry.getOrCreate('agent1', 'telegram', 'u1')
    registry.closeSession(session.session_id)
    expect(registry.getById(session.session_id)).toBeUndefined()
  })

  it('listByAgent 应过滤', () => {
    registry.getOrCreate('a1', 'telegram', 'u1')
    registry.getOrCreate('a1', 'telegram', 'u2')
    registry.getOrCreate('a2', 'telegram', 'u3')
    expect(registry.listByAgent('a1')).toHaveLength(2)
    expect(registry.listByAgent('a2')).toHaveLength(1)
  })

  it('listAll 返回所有', () => {
    registry.getOrCreate('a1', 'telegram', 'u1')
    registry.getOrCreate('a2', 'rest', 'u2')
    expect(registry.listAll()).toHaveLength(2)
  })
})
