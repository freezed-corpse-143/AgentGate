export interface TelegramChannelConfig {
    enabled: boolean;
    token: string;
    apiRoot?: string;
    allowFrom?: string[];
}
export interface RestChannelConfig {
    enabled: boolean;
    port: number;
    host?: string;
}
export interface SSHChannelConfig {
    enabled: boolean;
    port: number;
    host?: string;
    users?: Record<string, string>;
}
export interface AgentConfig {
    id: string;
    name: string;
    description?: string;
    capabilities?: string[];
}
export interface BridgeConfig {
    enabled: boolean;
    host: string;
    port: number;
    nodeId?: string;
}
export interface LoggingConfig {
    level: 'debug' | 'info' | 'warn' | 'error';
}
export interface AgentGateConfig {
    server: {
        defaultAgent: string;
    };
    channels: {
        /** �� Telegram Bot�������ݣ����ȼ����� telegrams�� */
        telegram?: TelegramChannelConfig;
        /** �� Telegram Bot ʵ����ÿ������ token�� */
        telegrams?: TelegramChannelConfig[];
        rest?: RestChannelConfig;
        ssh?: SSHChannelConfig;
    };
    agents: AgentConfig[];
    logging: LoggingConfig;
    bridge?: BridgeConfig;
}
export declare function loadConfig(): AgentGateConfig;
//# sourceMappingURL=config.d.ts.map