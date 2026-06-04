/**
 * AgentGate �� ����ϵͳ
 *
 * �� YAML �����ļ��ͻ������������������á�
 * �������ȼ�: �������� > �����ļ� > Ĭ��ֵ
 *
 * Ĭ��·��: ~/.agentgate/config.yaml
 * ��ͨ�� AGENTGATE_CONFIG ������������
 */
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { load as loadYaml } from 'js-yaml';
const DEFAULT_CONFIG = {
    server: { defaultAgent: 'default' },
    channels: {
        rest: { enabled: true, port: 3000, host: '0.0.0.0' },
        ssh: { enabled: false, port: 2222, host: '0.0.0.0' },
    },
    agents: [],
    logging: { level: 'info' },
    bridge: { enabled: false, host: 'localhost', port: 8444 },
};
function findConfigPath() {
    if (process.env.AGENTGATE_CONFIG)
        return process.env.AGENTGATE_CONFIG;
    const cwd = process.cwd();
    for (const name of ['agentgate.yaml', 'agentgate.yml', 'agentgate.json']) {
        const p = join(cwd, name);
        if (existsSync(p))
            return p;
    }
    const home = homedir();
    for (const name of ['.agentgate/config.yaml', '.agentgate/config.yml', '.agentgate/config.json']) {
        const p = join(home, name);
        if (existsSync(p))
            return p;
    }
    return null;
}
function mergeConfig(base, override) {
    return {
        server: { ...base.server, ...override.server },
        channels: { ...base.channels, ...(override.channels ?? {}) },
        agents: override.agents ?? base.agents,
        logging: { ...base.logging, ...override.logging },
        bridge: (override.bridge ?? base.bridge),
    };
}
function applyEnvOverrides(config) {
    if (process.env.AGENTGATE_REST_PORT) {
        if (!config.channels.rest)
            config.channels.rest = { enabled: true, port: 3000 };
        config.channels.rest.port = parseInt(process.env.AGENTGATE_REST_PORT, 10);
    }
    if (process.env.AGENTGATE_DEFAULT_AGENT) {
        config.server.defaultAgent = process.env.AGENTGATE_DEFAULT_AGENT;
    }
    if (process.env.TELEGRAM_BOT_TOKEN) {
        if (!config.channels.telegram)
            config.channels.telegram = { enabled: true, token: '' };
        config.channels.telegram.enabled = true;
        config.channels.telegram.token = process.env.TELEGRAM_BOT_TOKEN;
    }
    if (process.env.TELEGRAM_API_ROOT && config.channels.telegram) {
        config.channels.telegram.apiRoot = process.env.TELEGRAM_API_ROOT;
    }
    if (process.env.AGENTGATE_SSH_PORT) {
        if (!config.channels.ssh)
            config.channels.ssh = { enabled: false, port: 2222, host: '0.0.0.0' };
        config.channels.ssh.port = parseInt(process.env.AGENTGATE_SSH_PORT, 10);
        config.channels.ssh.enabled = true;
    }
    if (process.env.AGENTGATE_BRIDGE_HOST) {
        if (!config.bridge)
            config.bridge = { enabled: false, host: 'localhost', port: 8444 };
        config.bridge.host = process.env.AGENTGATE_BRIDGE_HOST;
    }
    if (process.env.AGENTGATE_BRIDGE_PORT) {
        if (!config.bridge)
            config.bridge = { enabled: false, host: 'localhost', port: 8444 };
        config.bridge.port = parseInt(process.env.AGENTGATE_BRIDGE_PORT, 10);
    }
    if (process.env.AGENTGATE_BRIDGE_ENABLED) {
        if (!config.bridge)
            config.bridge = { enabled: false, host: 'localhost', port: 8444 };
        config.bridge.enabled = process.env.AGENTGATE_BRIDGE_ENABLED === 'true' || process.env.AGENTGATE_BRIDGE_ENABLED === '1';
    }
    return config;
}
export function loadConfig() {
    const configPath = findConfigPath();
    let fileConfig = {};
    if (configPath) {
        try {
            const raw = readFileSync(configPath, 'utf8');
            if (configPath.endsWith('.json')) {
                fileConfig = JSON.parse(raw);
            }
            else {
                fileConfig = loadYaml(raw);
            }
            console.error(`[Config] Loaded from ${configPath}`);
        }
        catch (err) {
            console.warn(`[Config] Failed to load ${configPath}: ${err}`);
        }
    }
    let config = mergeConfig(DEFAULT_CONFIG, fileConfig);
    config = applyEnvOverrides(config);
    return config;
}
//# sourceMappingURL=config.js.map