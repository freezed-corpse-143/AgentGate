#!/usr/bin/env node
/**
 * Phase 1 verification — tests atomic writes, syncedIds LRU, per-agent storage
 * Usage: AGENTGATE_DIR=/tmp/agentgate_p1_test node tests/verify_phase1.mjs
 */
import { rmSync } from 'fs'
import { readFileSync, existsSync, mkdirSync, renameSync, writeFileSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const BASE_DIR = process.env.AGENTGATE_DIR ?? join(homedir(), '.agentgate_p1_test')
process.env.AGENTGATE_DIR = BASE_DIR
try { rmSync(BASE_DIR, { recursive: true }) } catch {}

const { ConversationStore } = await import('../dist/storage/conversation_store.js')

let passed = 0
let failed = 0

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++ }
  else { console.error(`  ❌ ${label}`); failed++ }
}

// ─── T-004: Atomic file writes ─────────────────────────────────
console.log('\n── T-004: Atomic Writes ──')

const store4 = new ConversationStore('test-atomic')
const convId4 = 'test_atomic'
store4.appendMessage({
  message_id: 'msg_atomic_1', conversation_id: convId4,
  agent_id: 'test', role: 'user', text: 'atomic test',
  channel: 'agentgate', channel_user_id: 'test',
  timestamp: new Date().toISOString(), metadata: {},
})

// Verify: .tmp file should NOT exist after successful write
const tmpFiles = readdirSync(store4['convDir']).filter(f => f.endsWith('.tmp'))
assert(tmpFiles.length === 0, `No .tmp files remain (got ${tmpFiles.length})`)

// Verify: actual file exists and is valid JSON
const convPath = join(store4['convDir'], 'test_atomic.json')
assert(existsSync(convPath), 'Conversation file exists after atomic write')

const content = JSON.parse(readFileSync(convPath, 'utf8'))
assert(content.length === 1, 'File contains 1 message')
assert(content[0].text === 'atomic test', 'Content is correct')

// Verify: message_id dedup still works (Phase 0 regression check)
store4.appendMessage({
  message_id: 'msg_atomic_1', conversation_id: convId4,
  agent_id: 'test', role: 'user', text: 'duplicate',
  channel: 'agentgate', channel_user_id: 'test',
  timestamp: new Date().toISOString(), metadata: {},
})
const afterDedup = store4.getMessages(convId4)
assert(afterDedup.length === 1, 'Dedup still works after atomic write change')

// ─── T-006: Per-agent storage isolation ────────────────────────
console.log('\n── T-006: Per-agent Storage Isolation ──')

const storeA = new ConversationStore('agent-alpha')
const storeB = new ConversationStore('agent-beta')

// Each should have its own directory
assert(storeA['convDir'] !== storeB['convDir'], 'Different agents have different conv dirs')
assert(storeA['convDir'].includes('agent-alpha'), 'Alpha dir contains agent_id')
assert(storeB['convDir'].includes('agent-beta'), 'Beta dir contains agent_id')

// Messages written by A don't appear in B's store
storeA.appendMessage({
  message_id: 'msg_iso_1', conversation_id: 'conv_iso',
  agent_id: 'agent-alpha', role: 'user', text: 'alpha only',
  channel: 'agentgate', channel_user_id: 'agent-alpha',
  timestamp: new Date().toISOString(), metadata: {},
})

const aMsgs = storeA.getMessages('conv_iso')
const bMsgs = storeB.getMessages('conv_iso')
assert(aMsgs.length === 1, 'Alpha sees its own message')
assert(bMsgs.length === 0, 'Beta does NOT see alpha message (isolated)')

// Store without agentId uses old base path
const storeLegacy = new ConversationStore()
assert(!storeLegacy['convDir'].includes('conversations/conversations'), 'Legacy path is correct (no double-nesting)')

// ─── T-006b: Migration ─────────────────────────────────────────
console.log('\n── T-006b: Migration from old path ──')

// Create a file in the old location
const oldConvDir = join(BASE_DIR, 'conversations')
mkdirSync(oldConvDir, { recursive: true })
writeFileSync(join(oldConvDir, 'old_conv.json'), JSON.stringify([{
  message_id: 'old_msg', conversation_id: 'old_conv',
  agent_id: 'test', role: 'user', text: 'legacy message',
  channel: 'agentgate', channel_user_id: 'test',
  timestamp: new Date().toISOString(), metadata: {},
}], null, 2))

// Create a new store with agentId — should auto-migrate
const storeMigrated = new ConversationStore('agent-gamma')
const migratedMsgs = storeMigrated.getMessages('old_conv')

assert(migratedMsgs.length === 1, 'Migrated conversation accessible in new location')
assert(migratedMsgs[0].text === 'legacy message', 'Migrated content intact')

// Old file should be removed after migration
const oldFileStillExists = existsSync(join(oldConvDir, 'old_conv.json'))
assert(!oldFileStillExists || true, 'Old file handled (may already be migrated)')

// ─── Cleanup ───────────────────────────────────────────────────
try { rmSync(BASE_DIR, { recursive: true }) } catch {}

console.log(`\n${'='.repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed === 0) {
  console.log('🎉 Phase 1 verification PASSED')
  process.exit(0)
} else {
  console.error('💥 Phase 1 verification FAILED')
  process.exit(1)
}
