/**
 * AgentGate — 配置系统
 *
 * 从 YAML 配置文件和环境变量加载运行配置。
 * 配置优先级: 环境变量 > 配置文件 > 默认值
 *
 * 默认路径: ~/.agentgate/config.yaml
 * 可通过 AGENTGATE_CONFIG 环境变量覆盖
 */
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { load as loadYaml } from 'js-yaml'

export interface TelegramChannelConfig {
  enabled: boolean
  token: string
  apiRoot?: string
  allowFrom?: string[]
}

export interface RestChannelConfig {
  enabled: boolean
  port: number
  host?: string
}

export interface SSHChannelConfig {
  enabled: boolean
  port: number
  host?: string
  users?: Record<string, string>
}

export interface AgentConfig {
  id: string
  name: string
  description?: string
  capabilities?: string[]
}

export interface BridgeConfig {
  enabled: boolean
  host: string
  port: number
  nodeId?: string
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error'
}

export interface AgentGateConfig {
  server: { defaultAgent: string }
  channels: {
    telegram?: TelegramChannelConfig
    rest?: RestChannelConfig
    ssh?: SSHChannelConfig
  }
  agents: AgentConfig[]
  logging: LoggingConfig
  bridge?: BridgeConfig
}

const DEFAULT_CONFIG: AgentGateConfig = {
  server: { defaultAgent: 'default' },
  channels: {
    rest: { enabled: true, port: 3000, host: '0.0.0.0' },
    ssh: { enabled: false, port: 2222, host: '0.0.0.0' },
  },
  agents: [],
  logging: { level: 'info' },
  bridge: { enabled: false, host: 'localhost', port: 8444 },
}

function findConfigPath(): string | null {
  if (process.env.AGENTGATE_CONFIG) return process.env.AGENTGATE_CONFIG
  const cwd = process.cwd()
  for (const name of ['agentgate.yaml', 'agentgate.yml', 'agentgate.json']) {
    const p = join(cwd, name)
    if (existsSync(p)) return p
  }
  const home = homedir()
  for (const name of ['.agentgate/config.yaml', '.agentgate/config.yml', '.agentgate/config.json']) {
    const p = join(home, name)
    if (existsSync(p)) return p
  }
  return null
}

function mergeConfig(base: AgentGateConfig, override: Partial<AgentGateConfig>): AgentGateConfig {
  return {
    server: { ...base.server, ...override.server },
    channels: { ...base.channels, ...(override.channels ?? {}) },
    agents: override.agents ?? base.agents,
    logging: { ...base.logging, ...override.logging },
    bridge: (override.bridge ?? base.bridge) as BridgeConfig,
  }
}

function applyEnvOverrides(config: AgentGateConfig): AgentGateConfig {
  if (process.env.AGENTGATE_REST_PORT) {
    if (!config.channels.rest) config.channels.rest = { enabled: true, port: 3000 }
    config.channels.rest.port = parseInt(process.env.AGENTGATE_REST_PORT, 10)
  }
  if (process.env.AGENTGATE_DEFAULT_AGENT) {
    config.server.defaultAgent = process.env.AGENTGATE_DEFAULT_AGENT
  }
  if (process.env.TELEGRAM_BOT_TOKEN) {
    if (!config.channels.telegram) config.channels.telegram = { enabled: true, token: '' }
    config.channels.telegram.enabled = true
    config.channels.telegram.token = process.env.TELEGRAM_BOT_TOKEN
  }
  if (process.env.TELEGRAM_API_ROOT && config.channels.telegram) {
    config.channels.telegram.apiRoot = process.env.TELEGRAM_API_ROOT
  }
  if (process.env.AGENTGATE_SSH_PORT) {
    if (!config.channels.ssh) config.channels.ssh = { enabled: false, port: 2222, host: '0.0.0.0' }
    config.channels.ssh.port = parseInt(process.env.AGENTGATE_SSH_PORT, 10)
    config.channels.ssh.enabled = true
  }
  if (process.env.AGENTGATE_BRIDGE_HOST) {
    if (!config.bridge) config.bridge = { enabled: false, host: 'localhost', port: 8444 }
    config.bridge.host = process.env.AGENTGATE_BRIDGE_HOST
  }
  if (process.env.AGENTGATE_BRIDGE_PORT) {
    if (!config.bridge) config.bridge = { enabled: false, host: 'localhost', port: 8444 }
    config.bridge.port = parseInt(process.env.AGENTGATE_BRIDGE_PORT, 10)
  }
  if (process.env.AGENTGATE_BRIDGE_ENABLED) {
    if (!config.bridge) config.bridge = { enabled: false, host: 'localhost', port: 8444 }
    config.bridge.enabled = process.env.AGENTGATE_BRIDGE_ENABLED === 'true' || process.env.AGENTGATE_BRIDGE_ENABLED === '1'
  }
  return config
}

export function loadConfig(): AgentGateConfig {
  const configPath = findConfigPath()
  let fileConfig: Partial<AgentGateConfig> = {}
  if (configPath) {
    try {
      const raw = readFileSync(configPath, 'utf8')
      if (configPath.endsWith('.json')) {
        fileConfig = JSON.parse(raw)
      } else {
        fileConfig = loadYaml(raw) as Partial<AgentGateConfig>
      }
      console.log(`[Config] Loaded from ${configPath}`)
    } catch (err) {
      console.warn(`[Config] Failed to load ${configPath}: ${err}`)
    }
  }
  let config = mergeConfig(DEFAULT_CONFIG, fileConfig)
  config = applyEnvOverrides(config)
  return config
}
