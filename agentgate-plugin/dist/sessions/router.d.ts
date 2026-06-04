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
import type { Envelope } from '../types.js';
import type { BindingStore } from '../auth/binding_store.js';
import type { AgentRegistry } from '../agents/registry.js';
import type { SessionRegistry } from './session_registry.js';
import type { SessionInfo } from '../types.js';
export interface RouteResult {
    session: SessionInfo;
    agentExists: boolean;
}
export declare class SessionRouter {
    private bindingStore;
    private agentRegistry;
    private sessionRegistry;
    constructor(bindingStore: BindingStore, agentRegistry: AgentRegistry, sessionRegistry: SessionRegistry);
    /** 路由入站 Envelope */
    route(envelope: Envelope): RouteResult | null;
}
//# sourceMappingURL=router.d.ts.map