/**
 * 单元测试: Agent Registry
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { AgentRegistry } from '../../src/agents/registry.js'

describe('AgentRegistry', () => {
  let registry: AgentRegistry

  beforeEach(() => {
    registry = new AgentRegistry()
  })

  const alpha = {
    agent_id: 'agent-alpha',
    name: 'Alpha Agent',
    description: 'Test agent',
    capabilities: ['chat', 'code'],
    status: 'idle' as const,
    registered_at: '2026-01-01T00:00:00Z',
  }

  const beta = {
    agent_id: 'agent-beta',
    name: 'Beta Agent',
    description: 'Another test agent',
    capabilities: ['chat', 'review'],
    status: 'idle' as const,
    registered_at: '2026-01-01T00:00:00Z',
  }

  it('初始时应为空', () => {
    expect(registry.listAll()).toEqual([])
  })

  it('应注册和查找 Agent', () => {
    registry.register(alpha)
    const found = registry.findAgent('agent-alpha')
    expect(found).toBeDefined()
    expect(found?.name).toBe('Alpha Agent')
  })

  it('应注销 Agent', () => {
    registry.register(alpha)
    expect(registry.unregister('agent-alpha')).toBe(true)
    expect(registry.findAgent('agent-alpha')).toBeUndefined()
  })

  it('注销不存在的 Agent 应返回 false', () => {
    expect(registry.unregister('nonexistent')).toBe(false)
  })

  it('应按能力筛选 Agent', () => {
    registry.register(alpha)
    registry.register(beta)
    const coders = registry.findByCapability('code')
    expect(coders).toHaveLength(1)
    expect(coders[0].agent_id).toBe('agent-alpha')

    const chatters = registry.findByCapability('chat')
    expect(chatters).toHaveLength(2)
  })

  it('应列出所有 Agent', () => {
    registry.register(alpha)
    registry.register(beta)
    expect(registry.listAll()).toHaveLength(2)
  })

  it('应更新 Agent 状态', () => {
    registry.register(alpha)
    expect(registry.updateStatus('agent-alpha', 'busy')).toBe(true)
    expect(registry.findAgent('agent-alpha')?.status).toBe('busy')
  })

  it('更新不存在的 Agent 状态应返回 false', () => {
    expect(registry.updateStatus('ghost', 'busy')).toBe(false)
  })

  it('clear 应清空所有 Agent', () => {
    registry.register(alpha)
    registry.register(beta)
    registry.clear()
    expect(registry.listAll()).toHaveLength(0)
  })
})
