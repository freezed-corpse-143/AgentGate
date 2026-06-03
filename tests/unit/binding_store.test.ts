/**
 * 单元测试: Binding Store
 *
 * 使用 vitest 的 vi.mock 模拟 fs 操作。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BindingStore } from '../../src/auth/binding_store.js'

// 模拟 fs 模块
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

// 模拟 path.join 和 homedir
vi.mock('path', () => ({
  join: (...parts: string[]) => parts.join('/'),
  default: { join: (...parts: string[]) => parts.join('/') },
}))

vi.mock('os', () => ({
  homedir: () => '/fake/home',
}))

describe('BindingStore', () => {
  let store: BindingStore

  beforeEach(() => {
    // 清理模拟数据
    Object.keys(mockData).forEach(k => delete mockData[k])
    store = new BindingStore()
  })

  it('空的 store 应返回 undefined', () => {
    const binding = store.getBinding('telegram', 'user1')
    expect(binding).toBeUndefined()
  })

  it('应创建并查询绑定', () => {
    const b = store.createBinding({
      channel_type: 'telegram',
      channel_user_id: 'user1',
      principal_id: 'p1',
      agent_id: 'agent-alpha',
      permissions: ['read', 'write'],
      status: 'active',
    })
    expect(b.id).toMatch(/^bind_/)
    expect(b.channel_type).toBe('telegram')

    const found = store.getBinding('telegram', 'user1')
    expect(found).toBeDefined()
    expect(found?.agent_id).toBe('agent-alpha')
  })

  it('应只返回 active 状态的绑定', () => {
    store.createBinding({
      channel_type: 'telegram',
      channel_user_id: 'user_revoked',
      principal_id: 'p1',
      agent_id: 'agent1',
      permissions: ['read'],
      status: 'revoked',
    })
    const found = store.getBinding('telegram', 'user_revoked')
    expect(found).toBeUndefined()
  })

  it('应通过 ID 查询绑定', () => {
    const b = store.createBinding({
      channel_type: 'rest',
      channel_user_id: 'u1',
      principal_id: 'p1',
      agent_id: 'a1',
      permissions: ['read'],
      status: 'active',
    })
    const found = store.getById(b.id)
    expect(found).toBeDefined()
    expect(found?.channel_type).toBe('rest')
  })

  it('撤销绑定应更新状态', () => {
    const b = store.createBinding({
      channel_type: 'telegram',
      channel_user_id: 'u1',
      principal_id: 'p1',
      agent_id: 'a1',
      permissions: [],
      status: 'active',
    })
    store.revokeBinding(b.id)
    const revoked = store.getById(b.id)
    expect(revoked?.status).toBe('revoked')
  })

  it('updateLastSeen 应更新时间戳', async () => {
    const b = store.createBinding({
      channel_type: 'telegram',
      channel_user_id: 'u1',
      principal_id: 'p1',
      agent_id: 'a1',
      permissions: [],
      status: 'active',
    })
    const before = b.last_seen_at
    await new Promise(r => setTimeout(r, 5)) // 等待 5ms 确保时间戳变化
    store.updateLastSeen(b.id)
    const updated = store.getById(b.id)
    expect(updated?.last_seen_at).not.toBe(before)
  })

  it('listActive 只返回活跃绑定', () => {
    store.createBinding({ channel_type: 'telegram', channel_user_id: 'a', principal_id: 'p', agent_id: 'a1', permissions: [], status: 'active' })
    store.createBinding({ channel_type: 'rest', channel_user_id: 'b', principal_id: 'p', agent_id: 'a2', permissions: [], status: 'revoked' })
    store.createBinding({ channel_type: 'telegram', channel_user_id: 'c', principal_id: 'p', agent_id: 'a3', permissions: [], status: 'active' })

    const active = store.listActive()
    expect(active).toHaveLength(2)
  })

  it('listByChannel 应过滤信道', () => {
    store.createBinding({ channel_type: 'telegram', channel_user_id: 'a', principal_id: 'p', agent_id: 'a1', permissions: [], status: 'active' })
    store.createBinding({ channel_type: 'rest', channel_user_id: 'b', principal_id: 'p', agent_id: 'a2', permissions: [], status: 'active' })

    expect(store.listByChannel('telegram')).toHaveLength(1)
    expect(store.listByChannel('rest')).toHaveLength(1)
  })
})
