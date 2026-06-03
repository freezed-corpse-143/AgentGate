import ssh2 from 'ssh2'
const { Server: SshServer } = ssh2
import type { Connection, ServerChannel, Session, AuthContext, PasswordAuthContext } from 'ssh2'
import { generateKeyPairSync } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ChannelAdapter, MessageCallback } from './base.js'
import type { ChannelType, RawMessage, Envelope } from '../types.js'

const AGENTGATE_DIR = process.env.AGENTGATE_DIR ?? join(homedir(), '.agentgate')
const HOST_KEY_PATH = join(AGENTGATE_DIR, 'ssh_host_key.pem')

const WELCOME = [
  '',
  '=== AgentGate SSH Channel ===',
  'Type a message and press Enter.',
  'Commands: /help /status /exit',
  '',
].join('\n')

export interface SSHAdapterOptions {
  port: number
  host?: string
  users?: Record<string, string>
}

export class SSHAdapter implements ChannelAdapter {
  readonly channelType: ChannelType = 'ssh'
  private server: InstanceType<typeof SshServer> | null = null
  private callback: MessageCallback | null = null
  private options: SSHAdapterOptions
  private running = false
  private sessions: Map<string, ServerChannel> = new Map()

  constructor(options: SSHAdapterOptions) {
    this.options = options
  }

  onMessage(callback: MessageCallback): void {
    this.callback = callback
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    const hostKey = this.getOrCreateHostKey()
    return new Promise((resolve, reject) => {
      this.server = new SshServer({ hostKeys: [hostKey] }, (client: Connection) => this.handleClient(client))
      this.server.on('error', (err: Error) => { console.error(`[SSH] ${err.message}`); if (!this.running) reject(err) })
      this.server.listen(this.options.port, this.options.host ?? '0.0.0.0', () => {
        console.log(`[SSH] Listening on ${this.options.host ?? '0.0.0.0'}:${this.options.port}`)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    this.running = false
    this.server?.close()
    this.server = null
  }

  async send(envelope: Envelope): Promise<void> {
    const text = envelope.payload.text
    if (!text) return
    const session = this.sessions.get(envelope.channel_user_id)
    if (!session) { console.warn(`[SSH] No session for ${envelope.channel_user_id}`); return }
    try { session.write(`\n[Agent] ${text}\n\n> `) } catch (err) { console.error(`[SSH] Write error: ${err}`) }
  }

  addUser(username: string, password: string): void {
    if (!this.options.users) this.options.users = {}
    this.options.users[username] = password
  }

  private getOrCreateHostKey(): Buffer {
    if (existsSync(HOST_KEY_PATH)) return readFileSync(HOST_KEY_PATH)
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs1', format: 'pem' } })
    mkdirSync(AGENTGATE_DIR, { recursive: true })
    writeFileSync(HOST_KEY_PATH, privateKey)
    return Buffer.from(privateKey)
  }

  private handleClient(client: Connection): void {
    let userId = ''

    client.on('authentication', (ctx: AuthContext) => {
      const username = ctx.username
      if (ctx.method === 'password') {
        const pwdCtx = ctx as PasswordAuthContext
        const users = this.options.users ?? {}
        if (users[username] && pwdCtx.password === users[username]) { userId = username; ctx.accept(); return }
        ctx.reject(['password', 'publickey']); return
      }
      if (ctx.method === 'publickey') { ctx.accept(); userId = username; return }
      ctx.reject(['password', 'publickey'])
    })

    client.on('ready', () => {
      client.on('session', (accept: () => Session) => {
        const session = accept()

        session.on('shell', (accept: () => ServerChannel) => {
          const stream = accept()
          const sessionId = userId || `ssh_${Date.now()}`
          this.sessions.set(sessionId, stream)
          stream.write(WELCOME)
          stream.write('\n> ')
          let buffer = ''
          stream.on('data', (data: Buffer) => {
            buffer += data.toString('utf8')
            if (buffer.endsWith('\x7f') || buffer.endsWith('\b')) { buffer = buffer.slice(0, -1); return }
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed) { stream.write('> '); continue }
              if (trimmed.startsWith('/')) {
                if (trimmed === '/exit' || trimmed === '/quit') { stream.write('Goodbye.\n'); stream.close(); return }
                stream.write(`\n  Unknown: ${trimmed}\n\n> `); continue
              }
              this.callback?.({
                channel: 'ssh', channel_user_id: sessionId, chat_id: sessionId,
                text: trimmed, message_id: `ssh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              })
            }
          })
          stream.on('close', () => { this.sessions.delete(sessionId) })
        })

        session.on('exec', (accept: () => ServerChannel, reject: () => void, info: any) => {
          const stream = accept()
          const sessionId = userId || `ssh_exec_${Date.now()}`
          const cmd = (info?.command ?? '').trim()
          if (cmd) {
            this.callback?.({
              channel: 'ssh', channel_user_id: sessionId, chat_id: sessionId,
              text: cmd, message_id: `ssh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              metadata: { mode: 'exec' },
            })
          }
          stream.exit(0)
          stream.end()
        })
      })
    })

    client.on('close', () => {})
    client.on('error', () => {})
  }
}
