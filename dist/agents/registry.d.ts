/**
 * AgentGate — Agent Registry
 *
 * Agent 注册发现中心。Agent 启动时注册，关闭时注销。
 * 支持通过 agent_id 精确查找和按能力筛选。
 */
import type { AgentSpec, AgentStatus } from '../types.js';
export declare class AgentRegistry {
    private agents;
    /** 注册 Agent */
    register(spec: AgentSpec): void;
    /** 注销 Agent */
    unregister(agentId: string): boolean;
    /** 按 ID 查找 */
    findAgent(agentId: string): AgentSpec | undefined;
    /** 按能力筛选 */
    findByCapability(capability: string): AgentSpec[];
    /** 列出所有 Agent */
    listAll(): AgentSpec[];
    /** 更新 Agent 状态 */
    updateStatus(agentId: string, status: AgentStatus): boolean;
    /** 清空 (测试/关闭用) */
    clear(): void;
}
//# sourceMappingURL=registry.d.ts.map