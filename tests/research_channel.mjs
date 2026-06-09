#!/usr/bin/env node
/**
 * Phase 2 Research: Channel Notification Investigation
 *
 * Tests whether notifications/claude/channel can be made to work,
 * and evaluates alternative push mechanisms.
 */
import { spawn } from 'child_process'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const TMP = join(homedir(), '.agentgate_research_tmp')
try { mkdirSync(TMP, { recursive: true }) } catch {}

console.log('='.repeat(60))
console.log('Phase 2 Research: Channel Notification Mechanism')
console.log('='.repeat(60))

// ─── Experiment 1: Verify notification is sent on stdout ───────
console.log('\n── Experiment 1: Notification JSON-RPC Format ──')

const child = spawn('node', ['dist/mcp_server.js', '--agent-id', 'researcher'], {
  env: {
    ...process.env,
    AGENTGATE_DEFAULT_AGENT: 'researcher',
    AGENTGATE_BRIDGE_ENABLED: 'false',
    AGENTGATE_DIR: TMP,
    HOME: homedir(),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})

const stdoutLines = []
const stderrLines = []

child.stdout.on('data', d => stdoutLines.push(d.toString()))
child.stderr.on('data', d => stderrLines.push(d.toString()))

// Wait for server to start, then send a tool call
setTimeout(() => {
  // Send a list_conversations call (simplest)
  const call = JSON.stringify({
    jsonrpc: '2.0', id: '1',
    method: 'tools/call',
    params: { name: 'list_conversations', arguments: {} }
  }) + '\n'
  child.stdin.write(call)

  setTimeout(() => {
    child.kill()

    const stdout = stdoutLines.join('')
    const stderr = stderrLines.join('')

    // Check if channel notification JSON-RPC appears anywhere
    const hasChannelNotification = stdout.includes('notifications/claude/channel')
    console.log(`  Channel notification in stdout: ${hasChannelNotification ? 'YES ✅' : 'NO ❌'}`)
    console.log(`  stdout length: ${stdout.length} chars`)
    console.log(`  stderr length: ${stderr.length} chars`)

    // Show the JSON-RPC messages
    const rpcLines = stdout.split('\n').filter(l => l.trim().startsWith('{'))
    console.log(`  JSON-RPC messages on stdout: ${rpcLines.length}`)
    for (const line of rpcLines.slice(0, 5)) {
      try {
        const parsed = JSON.parse(line)
        console.log(`    → ${parsed.method || parsed.id ? 'response' : 'unknown'}: ${line.slice(0, 120)}`)
      } catch {
        console.log(`    → [parse error]: ${line.slice(0, 80)}`)
      }
    }

    // Show channel notification if present
    const channelIdx = stdout.indexOf('notifications/claude/channel')
    if (channelIdx !== -1) {
      console.log(`\n  Channel notification content:`)
      console.log(`    ${stdout.slice(channelIdx, channelIdx + 500)}`)
    }

    // Check stderr for notification errors
    const stderrNotificationErr = stderr.includes('channel notification failed')
    console.log(`  Channel notification error in stderr: ${stderrNotificationErr ? 'YES ❌' : 'NO ✅'}`)

    // Save full output for analysis
    writeFileSync(join(TMP, 'research_stdout.jsonl'), stdout)
    writeFileSync(join(TMP, 'research_stderr.log'), stderr)
    console.log(`\n  Full logs saved to ${TMP}/research_*`)

  }, 3000)
}, 3000)

// ─── Wait for completion ──────────────────────────────────────
setTimeout(() => {
  console.log('\n── Experiment 2: tengu_harbor_ledger Analysis ──')

  // Read current claude.json config
  try {
    const claudeJson = JSON.parse(
      require('fs').readFileSync(join(homedir(), '.claude.json'), 'utf8')
    )
    const ledger = claudeJson.cachedGrowthBookFeatures?.tengu_harbor_ledger || []
    console.log('  Current harbor ledger entries:')
    for (const entry of ledger) {
      console.log(`    - marketplace: "${entry.marketplace}", plugin: "${entry.plugin}"`)
    }

    // Analysis
    const hasLocal = ledger.some(e => e.marketplace === 'local')
    const hasOfficialAgentGate = ledger.some(e =>
      e.marketplace === 'claude-plugins-official' && e.plugin === 'agentgate'
    )
    console.log(`\n  Has "local" marketplace entry: ${hasLocal}`)
    console.log(`  Has official marketplace entry for agentgate: ${hasOfficialAgentGate}`)

    if (!hasOfficialAgentGate) {
      console.log('\n  💡 Hypothesis: Channel notification only works for marketplace-installed plugins.')
      console.log('  The "local" marketplace type may not receive channel permissions.')
      console.log('  Recommendation: Document this as known limitation, implement polling fallback.')
    }

  } catch (e) {
    console.log(`  Error reading claude.json: ${e.message}`)
  }

  // ─── Experiment 3: Alternative push mechanisms ──────────────
  console.log('\n── Experiment 3: Alternative Push Mechanisms ──')
  console.log('  Evaluating options for real-time message delivery:')
  console.log('')
  console.log('  Option A: Channel notification (ideal)')
  console.log('    Status: NOT working with --plugin-dir loading')
  console.log('    Workaround: None known for v2.1.169')
  console.log('')
  console.log('  Option B: Auto-poll via periodic tool call')
  console.log('    Mechanism: MCP server injects a synthetic tool response periodically')
  console.log('    Pro: Works with current Claude version')
  console.log('    Con: Adds latency (poll interval), wastes tokens')
  console.log('')
  console.log('  Option C: pendingMessages enhancement (current behavior)')
  console.log('    Mechanism: Queue messages, append to next tool response via drainPending()')
  console.log('    Pro: Zero overhead, works reliably')
  console.log('    Con: No push — user must trigger a tool call to see messages')
  console.log('')
  console.log('  Option D: File-watch + system-reminder')
  console.log('    Mechanism: MCP server writes messages to a file, Claude watches it')
  console.log('    Pro: Could trigger real-time context injection')
  console.log('    Con: Requires filesystem polling, fragile')
  console.log('')
  console.log('  ✅ Recommendation: Implement Option C+ (enhanced pendingMessages)')
  console.log('     - Add "unread message count" to EVERY tool response (not just when pending)')
  console.log('     - Add AGENTGATE_PUSH_MODE=poll with configurable interval')
  console.log('     - Document channel notification as "future when Claude supports it"')

  process.exit(0)
}, 8000)
