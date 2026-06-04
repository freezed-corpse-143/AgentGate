/**
 * AgentGate — Server 启动函数
 */
import { MemoryBus } from './bus/memory_bus.js';
import { AgentRegistry } from './agents/registry.js';
import { AgentRuntime } from './agents/runtime.js';
import { ConversationStore } from './storage/conversation_store.js';
import type { AgentGateConfig } from './config.js';
import type { ChannelAdapter } from './channels/base.js';
export interface ServerOptions {
    headless?: boolean;
}
export interface AgentGateServer {
    bus: MemoryBus;
    agentRegistry: AgentRegistry;
    runtime: AgentRuntime;
    adapters: ChannelAdapter[];
    conversationStore: ConversationStore;
    shutdown: () => Promise<void>;
}
export declare function startServer(config: AgentGateConfig, opts?: ServerOptions): Promise<AgentGateServer>;
//# sourceMappingURL=server.d.ts.map