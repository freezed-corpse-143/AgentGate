/**
 * 集成测试: SSH Adapter
 *
 * 启动 SSH Server → ssh2 Client 连接 → 发送消息 → 验证回复。
 *
 * 架构:
 *   ssh2 Client → SSH Server → SSHAdapter → callback (模拟 Gateway)
 *     → reply back to SSH session
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import ssh2 from 'ssh2'
const { Client: SshClient } = ssh2
import { SSHAdapter } from '../../src/channels/ssh_adapter.js'
import { createServer as createNetServer } from 'net'
import type { RawMessage } from '../../src/types.js'

async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createNetServer()
    s.listen(0, () => {
      const port = (s.address() as any).port
      s.close(() => resolve(port))
    })
  })
}

function sshExec(host: string, port: number, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new SshClient()
    const output: string[] = []

    client.on('ready', () => {
      client.exec(cmd, (err, stream) => {
        if (err) { reject(err); return }
        stream.on('data', (data: Buffer) => output.push(data.toString()))
        stream.stderr.on('data', (data: Buffer) => output.push(data.toString()))
        stream.on('close', () => {
          client.end()
          resolve(output.join(''))
        })
      })
    })

    client.on('error', reject)

    client.connect({
      host,
      port,
      username: 'testuser',
      password: 'testpass',
      readyTimeout: 5000,
    })
  })
}

describe('SSH Adapter', () => {
  let sshAdapter: SSHAdapter
  let port: number
  let lastRaw: RawMessage | null = null

  beforeAll(async () => {
    port = await findFreePort()
    sshAdapter = new SSHAdapter({
      port,
      host: '127.0.0.1',
      users: { testuser: 'testpass' },
    })

    // 模拟 Gateway callback：记录消息，发送回复
    sshAdapter.onMessage((raw: RawMessage) => {
      lastRaw = raw
      // 模拟回复（会被 send() 写回 SSH session）
    })

    await sshAdapter.start()
  }, 15000)

  afterAll(async () => {
    await sshAdapter.stop()
  })

  it('SSH Server 应接受密码认证连接', async () => {
    const client = new SshClient()
    const connected = new Promise<void>((resolve, reject) => {
      client.on('ready', () => { client.end(); resolve() })
      client.on('error', reject)
      client.connect({ host: '127.0.0.1', port, username: 'testuser', password: 'testpass', readyTimeout: 5000 })
    })
    await connected
    expect(true).toBe(true)
  })

  it('Exec 模式: 发送命令应触发 RawMessage', async () => {
    lastRaw = null
    await sshExec('127.0.0.1', port, 'hello ssh')
    await new Promise(r => setTimeout(r, 500))

    expect(lastRaw).not.toBeNull()
    expect(lastRaw!.channel).toBe('ssh')
    expect(lastRaw!.text).toBe('hello ssh')
  })

  it('多条 exec 命令应依次触发 RawMessage', async () => {
    lastRaw = null
    await sshExec('127.0.0.1', port, 'first command')
    await sshExec('127.0.0.1', port, 'second command')
    await new Promise(r => setTimeout(r, 500))

    // 最后一次应触发 second command
    expect(lastRaw).not.toBeNull()
    expect(lastRaw!.text).toBe('second command')
  })
})
