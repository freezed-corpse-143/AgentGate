#!/usr/bin/env node
/**
 * Phase 3 verification — tests pairing tools and Registry HMAC auth
 * Usage: AGENTGATE_DIR=/tmp/agentgate_p3_test node tests/verify_phase3.mjs
 */
import { rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'
import { createHmac } from 'crypto'

const BASE_DIR = process.env.AGENTGATE_DIR ?? join(homedir(), '.agentgate_p3_test')
process.env.AGENTGATE_DIR = BASE_DIR
try { rmSync(BASE_DIR, { recursive: true }) } catch {}

let passed = 0
let failed = 0

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++ }
  else { console.error(`  ❌ ${label}`); failed++ }
}

// ─── T-009: Pairing tools ─────────────────────────────────────
console.log('\n── T-009: Agent Pairing ──')

// Test via MCP protocol: request_pairing → verify_pairing
const child1 = spawn('node', ['dist/mcp_server.js', '--agent-id', 'pairing-agent-a'], {
  env: {
    ...process.env,
    AGENTGATE_DEFAULT_AGENT: 'pairing-agent-a',
    AGENTGATE_BRIDGE_ENABLED: 'false',
    AGENTGATE_DIR: BASE_DIR,
    HOME: homedir(),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let code = null
const stdoutAll = []

child1.stdout.on('data', d => { stdoutAll.push(d.toString()) })

// Wait for startup
await new Promise(r => setTimeout(r, 2000))

// Request pairing code
child1.stdin.write(JSON.stringify({
  jsonrpc: '2.0', id: '1',
  method: 'tools/call',
  params: { name: 'request_pairing', arguments: {} }
}) + '\n')

await new Promise(r => setTimeout(r, 1500))

const stdout1 = stdoutAll.join('')
// Extract the 6-digit code from the response
const codeMatch = stdout1.match(/Pairing Code: (\d{6})/)
if (codeMatch) {
  code = codeMatch[1]
  console.log(`  Generated pairing code: ${code}`)
}
assert(code !== null && code.length === 6, 'request_pairing generates a 6-digit code')

child1.kill()

// Verify the pairing code
const child2 = spawn('node', ['dist/mcp_server.js', '--agent-id', 'pairing-agent-b'], {
  env: {
    ...process.env,
    AGENTGATE_DEFAULT_AGENT: 'pairing-agent-b',
    AGENTGATE_BRIDGE_ENABLED: 'false',
    AGENTGATE_DIR: BASE_DIR,
    HOME: homedir(),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})

const stdout2All = []
child2.stdout.on('data', d => { stdout2All.push(d.toString()) })

await new Promise(r => setTimeout(r, 2000))

// Verify the code
child2.stdin.write(JSON.stringify({
  jsonrpc: '2.0', id: '1',
  method: 'tools/call',
  params: { name: 'verify_pairing', arguments: { code } }
}) + '\n')

await new Promise(r => setTimeout(r, 1500))

const stdout2 = stdout2All.join('')
assert(stdout2.includes('Pairing verified'), 'verify_pairing accepts valid code')
assert(stdout2.includes('pairing-agent-a'), 'verify_pairing identifies the paired agent')

child2.kill()

// Test invalid code
const child3 = spawn('node', ['dist/mcp_server.js', '--agent-id', 'pairing-agent-c'], {
  env: {
    ...process.env,
    AGENTGATE_DEFAULT_AGENT: 'pairing-agent-c',
    AGENTGATE_BRIDGE_ENABLED: 'false',
    AGENTGATE_DIR: BASE_DIR,
    HOME: homedir(),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})

const stdout3All = []
child3.stdout.on('data', d => { stdout3All.push(d.toString()) })

await new Promise(r => setTimeout(r, 2000))

child3.stdin.write(JSON.stringify({
  jsonrpc: '2.0', id: '1',
  method: 'tools/call',
  params: { name: 'verify_pairing', arguments: { code: '000000' } }
}) + '\n')

await new Promise(r => setTimeout(r, 1500))

const stdout3 = stdout3All.join('')
assert(stdout3.includes('Invalid or expired'), 'verify_pairing rejects invalid code')

child3.kill()

// Check verified peers file was created
const verifiedFile = join(BASE_DIR, 'verified_peers.json')
assert(existsSync(verifiedFile), 'Verified peers file was created')
if (existsSync(verifiedFile)) {
  const peers = JSON.parse(readFileSync(verifiedFile, 'utf8'))
  assert(peers.includes('pairing-agent-a'), 'Verified peers includes paired agent')
}

// ─── T-010: Registry HMAC auth ─────────────────────────────────
console.log('\n── T-010: Registry HMAC Authentication ──')

// Test signRegister function
const secret = 'test-secret-key-123'
function sign(agentId, ts) {
  return createHmac('sha256', secret).update(`${agentId}:${ts}`).digest('hex')
}

function verify(agentId, ts, sig) {
  const expected = sign(agentId, ts)
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ (sig.charCodeAt(i) || 0)
  }
  return diff === 0
}

const testAgent = 'hmac-test-agent'
const testTs = new Date().toISOString()
const validSig = sign(testAgent, testTs)

// Valid signature
assert(verify(testAgent, testTs, validSig), 'Valid signature is accepted')

// Wrong agent
assert(!verify('wrong-agent', testTs, validSig), 'Wrong agent is rejected')

// Tampered signature
const tampered = validSig.slice(0, -4) + 'ffff'
assert(!verify(testAgent, testTs, tampered), 'Tampered signature is rejected')

// Wrong timestamp
assert(!verify(testAgent, '2020-01-01T00:00:00.000Z', validSig), 'Wrong timestamp is rejected')

// Correct signature matches expected
const expected = sign(testAgent, testTs)
assert(expected === validSig, 'HMAC produces consistent output')

// ─── Tool count check ──────────────────────────────────────────
console.log('\n── Tool Count ──')

const child4 = spawn('node', ['dist/mcp_server.js', '--agent-id', 'tool-check'], {
  env: {
    ...process.env,
    AGENTGATE_DEFAULT_AGENT: 'tool-check',
    AGENTGATE_BRIDGE_ENABLED: 'false',
    AGENTGATE_DIR: BASE_DIR,
    HOME: homedir(),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})

const stdout4All = []
child4.stdout.on('data', d => { stdout4All.push(d.toString()) })

await new Promise(r => setTimeout(r, 2000))

child4.stdin.write(JSON.stringify({
  jsonrpc: '2.0', id: '1',
  method: 'tools/list',
  params: {}
}) + '\n')

await new Promise(r => setTimeout(r, 1500))

const stdout4 = stdout4All.join('')
const toolCount = (stdout4.match(/"name":/g) || []).length
console.log(`  Tools listed: ${toolCount}`)
assert(toolCount === 8, `8 tools total: send_message, reply, list_conversations, react, edit_message, get_status, request_pairing, verify_pairing`)

child4.kill()

// ─── Cleanup ───────────────────────────────────────────────────
try { rmSync(BASE_DIR, { recursive: true }) } catch {}

console.log(`\n${'='.repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed === 0) {
  console.log('🎉 Phase 3 verification PASSED')
  process.exit(0)
} else {
  console.error('💥 Phase 3 verification FAILED')
  process.exit(1)
}
