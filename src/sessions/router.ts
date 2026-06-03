/**
 * AgentGate — Session Router
 *
 * 路由 Envelope 到目标 Agent：查绑定 → 查/建 Session → 返回路由目标。
 *
 * 流程:
 *   Envelope → router.route()
 *     1. 从 envelope.auth.principal_id 查 BindingStore
 *     2. 从 binding.agent_id 查 AgentRegistry
 *     3. 查 SessionRegistry 是否有活跃会话
 *        ├── 无 → 创建新会话
 *        └── 有 → 复用
 *     4. 返回路由结果
 */
import type { Envelope } from '../types.js'
import type { BindingStore } from '../auth/binding_store.js'
import type { AgentRegistry } from '../agents/registry.js'
import type { SessionRegistry } from './session_registry.js'
import type { SessionInfo } from '../types.js'

export interface RouteResult {
  session: SessionInfo
  agentExists: boolean
}

export class SessionRouter {
  private bindingStore: BindingStore
  private agentRegistry: AgentRegistry
  private sessionRegistry: SessionRegistry

  constructor(
    bindingStore: BindingStore,
    agentRegistry: AgentRegistry,
    sessionRegistry: SessionRegistry,
  ) {
    this.bindingStore = bindingStore
    this.agentRegistry = agentRegistry
    this.sessionRegistry = sessionRegistry
  }

  /** 路由入站 Envelope */
  route(envelope: Envelope): RouteResult | null {
    // 1. 查绑定
    const binding = this.bindingStore.getBinding(envelope.channel, envelope.channel_user_id)
    if (!binding) return null

    // 2. 查 Agent
    const agent = this.agentRegistry.findAgent(binding.agent_id)
    const agentExists = agent !== undefined

    // 3. 查/创 Session
    const session = this.sessionRegistry.getOrCreate(
      binding.agent_id,
      envelope.channel,
      envelope.channel_user_id,
    )

    return { session, agentExists }
  }
}
