/**
 * AgentGate — Agent Registry
 *
 * Agent 注册发现中心。Agent 启动时注册，关闭时注销。
 * 支持通过 agent_id 精确查找和按能力筛选。
 */
import type { AgentSpec, AgentStatus } from '../types.js'

export class AgentRegistry {
  private agents: Map<string, AgentSpec> = new Map()

  /** 注册 Agent */
  register(spec: AgentSpec): void {
    this.agents.set(spec.agent_id, spec)
    console.error(`[AgentRegistry] Registered: ${spec.agent_id} (${spec.name})`)
  }

  /** 注销 Agent */
  unregister(agentId: string): boolean {
    const existed = this.agents.delete(agentId)
    if (existed) console.error(`[AgentRegistry] Unregistered: ${agentId}`)
    return existed
  }

  /** 按 ID 查找 */
  findAgent(agentId: string): AgentSpec | undefined {
    return this.agents.get(agentId)
  }

  /** 按能力筛选 */
  findByCapability(capability: string): AgentSpec[] {
    return Array.from(this.agents.values()).filter(
      a => a.capabilities.includes(capability),
    )
  }

  /** 列出所有 Agent */
  listAll(): AgentSpec[] {
    return Array.from(this.agents.values())
  }

  /** 更新 Agent 状态 */
  updateStatus(agentId: string, status: AgentStatus): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false
    agent.status = status
    return true
  }

  /** 清空 (测试/关闭用) */
  clear(): void {
    this.agents.clear()
  }
}
