export class AgentRegistry {
    agents = new Map();
    /** 注册 Agent */
    register(spec) {
        this.agents.set(spec.agent_id, spec);
        console.error(`[AgentRegistry] Registered: ${spec.agent_id} (${spec.name})`);
    }
    /** 注销 Agent */
    unregister(agentId) {
        const existed = this.agents.delete(agentId);
        if (existed)
            console.error(`[AgentRegistry] Unregistered: ${agentId}`);
        return existed;
    }
    /** 按 ID 查找 */
    findAgent(agentId) {
        return this.agents.get(agentId);
    }
    /** 按能力筛选 */
    findByCapability(capability) {
        return Array.from(this.agents.values()).filter(a => a.capabilities.includes(capability));
    }
    /** 列出所有 Agent */
    listAll() {
        return Array.from(this.agents.values());
    }
    /** 更新 Agent 状态 */
    updateStatus(agentId, status) {
        const agent = this.agents.get(agentId);
        if (!agent)
            return false;
        agent.status = status;
        return true;
    }
    /** 清空 (测试/关闭用) */
    clear() {
        this.agents.clear();
    }
}
//# sourceMappingURL=registry.js.map