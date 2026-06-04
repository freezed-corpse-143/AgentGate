export class SessionRouter {
    bindingStore;
    agentRegistry;
    sessionRegistry;
    constructor(bindingStore, agentRegistry, sessionRegistry) {
        this.bindingStore = bindingStore;
        this.agentRegistry = agentRegistry;
        this.sessionRegistry = sessionRegistry;
    }
    /** 路由入站 Envelope */
    route(envelope) {
        // 1. 查绑定
        const binding = this.bindingStore.getBinding(envelope.channel, envelope.channel_user_id);
        if (!binding)
            return null;
        // 2. 查 Agent
        const agent = this.agentRegistry.findAgent(binding.agent_id);
        const agentExists = agent !== undefined;
        // 3. 查/创 Session
        const session = this.sessionRegistry.getOrCreate(binding.agent_id, envelope.channel, envelope.channel_user_id);
        return { session, agentExists };
    }
}
//# sourceMappingURL=router.js.map