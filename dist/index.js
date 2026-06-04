#!/usr/bin/env node
/**
 * AgentGate — CLI 入口
 *
 * 用法:
 *   agentgate start             启动服务
 *   agentgate status            查看运行状态
 *   agentgate agents list       列出 Agent
 *   agentgate agents register   注册新 Agent
 *   agentgate conversations     列出对话
 *   agentgate conversations get <id>  查看对话消息
 */
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { startServer } from './server.js';
import { RegistryServer } from './bus/peer_bridge.js';
// ─── 全局状态 ──────────────────────────────────────────────────
let server = null;
const program = new Command();
program
    .name('agentgate')
    .description('Multi-channel agent communication infrastructure')
    .version('0.1.0');
// ─── start ───────────────────────────────────────────────────
program
    .command('start')
    .description('Start the AgentGate server')
    .option('-c, --config <path>', 'Config file path')
    .option('-p, --port <port>', 'REST API port', (v) => parseInt(v, 10))
    .option('--bridge', 'Enable bridge client (uses config or defaults)')
    .option('--bridge-port <port>', 'Bridge server port', (v) => parseInt(v, 10))
    .action(async (opts) => {
    const config = loadConfig();
    if (opts.port) {
        if (config.channels.rest)
            config.channels.rest.port = opts.port;
    }
    if (opts.config)
        process.env.AGENTGATE_CONFIG = opts.config;
    if (opts.bridge) {
        if (!config.bridge)
            config.bridge = { enabled: false, host: 'localhost', port: 8444 };
        config.bridge.enabled = true;
    }
    if (opts.bridgePort) {
        if (!config.bridge)
            config.bridge = { enabled: false, host: 'localhost', port: 8444 };
        config.bridge.enabled = true;
        config.bridge.port = opts.bridgePort;
    }
    try {
        server = await startServer(config);
        // 保持进程运行
        const shutdown = async () => {
            await server.shutdown();
            process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }
    catch (err) {
        console.error('Failed to start:', err);
        process.exit(1);
    }
});
// ─── status ──────────────────────────────────────────────────
program
    .command('status')
    .description('Show server status')
    .action(() => {
    if (!server) {
        // 尝试从环境读取配置并启动临时检查
        console.log('AgentGate server is not running in this process.');
        console.log('Use "agentgate start" to start.');
        return;
    }
    const agents = server.agentRegistry.listAll();
    const conversations = server.conversationStore.listConversations();
    console.log('AgentGate Status:');
    console.log(`  Agents: ${agents.length}`);
    for (const a of agents) {
        console.log(`    - ${a.agent_id} (${a.name}) [${a.status}]`);
    }
    console.log(`  Conversations: ${conversations.length}`);
    for (const c of conversations.slice(0, 5)) {
        console.log(`    - ${c.conversation_id}: ${c.message_count} msgs`);
    }
});
// ─── bridge ──────────────────────────────────────────────────
program
    .command('bridge')
    .description('Start a standalone TCP bridge server for cross-process messaging')
    .argument('[port]', 'Listen port', (v) => parseInt(v, 10), 8444)
    .option('-h, --host <host>', 'Listen address', '0.0.0.0')
    .action(async (port, opts) => {
    const reg = new RegistryServer({ port, host: opts.host });
    try {
        await reg.start();
        console.log(`[AgentGate Bridge v2] Registry running on ${opts.host}:${port}`);
        console.log('[AgentGate Bridge v2] Press Ctrl+C to stop');
        const shutdown = () => {
            console.log('[AgentGate Bridge v2] Shutting down...');
            reg.stop();
            process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }
    catch (err) {
        console.error(`[AgentGate Bridge v2] Failed to start: ${err}`);
        process.exit(1);
    }
});
// ─── agents ──────────────────────────────────────────────────
const agentsCmd = program.command('agents').description('Manage agents');
agentsCmd
    .command('list')
    .description('List registered agents')
    .action(() => {
    const config = loadConfig();
    console.log('Configured agents:');
    for (const a of config.agents) {
        console.log(`  - ${a.id}: ${a.name}${a.description ? ` (${a.description})` : ''}`);
    }
    if (config.agents.length === 0) {
        console.log('  (none configured, using default agent)');
    }
});
agentsCmd
    .command('register')
    .description('Register a new agent in config')
    .argument('<id>', 'Agent ID')
    .argument('<name>', 'Agent name')
    .option('-d, --description <desc>', 'Description')
    .option('-c, --capabilities <caps>', 'Comma-separated capabilities')
    .action((id, name, opts) => {
    console.log(`Registering agent: ${id} (${name})`);
    console.log('To persist this agent, add to your config file:');
    console.log(JSON.stringify({
        id,
        name,
        description: opts.description,
        capabilities: opts.capabilities?.split(',') ?? [],
    }, null, 2));
});
// ─── conversations ───────────────────────────────────────────
const convCmd = program.command('conversations').description('Manage conversations');
convCmd
    .command('list')
    .description('List all conversations')
    .action(async () => {
    if (!server) {
        // 从存储读取
        const { ConversationStore } = await import('./storage/conversation_store.js');
        const store = new ConversationStore();
        const convs = store.listConversations();
        console.log(`Conversations (${convs.length}):`);
        for (const c of convs) {
            console.log(`  ${c.conversation_id}: ${c.agent_id}, ${c.message_count} msgs, last: ${c.last_active_at}`);
        }
        return;
    }
    const convs = server.conversationStore.listConversations();
    console.log(`Conversations (${convs.length}):`);
    for (const c of convs) {
        console.log(`  ${c.conversation_id}: ${c.agent_id}, ${c.message_count} msgs`);
    }
});
convCmd
    .command('get')
    .description('Get messages in a conversation')
    .argument('<id>', 'Conversation ID')
    .option('-l, --limit <n>', 'Max messages', (v) => parseInt(v, 10))
    .action(async (id, opts) => {
    const { ConversationStore } = await import('./storage/conversation_store.js');
    const store = new ConversationStore();
    const msgs = store.getMessages(id, { limit: opts.limit ?? 50 });
    console.log(`Conversation ${id} (${msgs.length} messages):`);
    for (const m of msgs) {
        const role = m.role === 'user' ? '>' : '<';
        const ts = m.timestamp.slice(11, 19);
        const text = m.text.slice(0, 100).replace(/\n/g, '\\n');
        console.log(`  ${ts} [${role}] ${text}`);
    }
});
// ─── 解析 ────────────────────────────────────────────────────
program.parse(process.argv);
// 如果没有子命令，显示帮助
if (!process.argv.slice(2).length) {
    program.help();
}
//# sourceMappingURL=index.js.map