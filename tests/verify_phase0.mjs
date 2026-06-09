#!/usr/bin/env node
/**
 * Phase 0 verification — tests edit_message, react, and dedup fixes
 * Usage: AGENTGATE_DIR=/tmp/agentgate_test node tests/verify_phase0.mjs
 */
import { rmSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// Must be set BEFORE ConversationStore module loads (ESM hoisting)
const BASE_DIR = process.env.AGENTGATE_DIR ?? join(homedir(), '.agentgate_phase0_test')
process.env.AGENTGATE_DIR = BASE_DIR

// Clean test dir
try { rmSync(BASE_DIR, { recursive: true }) } catch {}

// Dynamic import to ensure env var is set before module evaluation
const { ConversationStore } = await import('../dist/storage/conversation_store.js')

let passed = 0
let failed = 0

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.error(`  ❌ ${label}`)
    failed++
  }
}

// ─── T-003: Dedup test ────────────────────────────────────────
console.log('\n── T-003: Message Deduplication ──')

const store = new ConversationStore()
const convId = 'test_conv_dedup'
const msgId = 'test_msg_001'

store.appendMessage({
  message_id: msgId, conversation_id: convId,
  agent_id: 'agent-alpha', role: 'user', text: 'first append',
  channel: 'agentgate', channel_user_id: 'agent-alpha',
  timestamp: new Date().toISOString(), metadata: {},
})

// Append same message_id again — should be skipped
store.appendMessage({
  message_id: msgId, conversation_id: convId,
  agent_id: 'agent-beta', role: 'user', text: 'duplicate append',
  channel: 'agentgate', channel_user_id: 'agent-beta',
  timestamp: new Date().toISOString(), metadata: {},
})

const msgs = store.getMessages(convId)
assert(msgs.length === 1, `Dedup: 2 appends with same message_id → ${msgs.length} stored (expect 1)`)
assert(msgs[0].text === 'first append', 'Dedup: original message text preserved')

// ─── T-001: Edit message test ─────────────────────────────────
console.log('\n── T-001: Edit Message ──')

const editConvId = 'test_conv_edit'
const editMsgId = 'test_msg_edit_001'

store.appendMessage({
  message_id: editMsgId, conversation_id: editConvId,
  agent_id: 'agent-alpha', role: 'user', text: 'original text',
  channel: 'agentgate', channel_user_id: 'agent-alpha',
  timestamp: new Date().toISOString(), metadata: {},
})

// Edit the message
const updated = store.updateMessage(editConvId, editMsgId, 'edited text')
assert(updated === true, 'updateMessage returns true for existing message')

const editedMsgs = store.getMessages(editConvId)
assert(editedMsgs.length === 1, 'Edit: still 1 message after edit')
assert(editedMsgs[0].text === 'edited text', 'Edit: text changed to new value')
assert(editedMsgs[0].metadata?.edited === true, 'Edit: metadata.edited === true')
assert(editedMsgs[0].metadata?.edited_at !== undefined, 'Edit: metadata.edited_at set')
assert(Array.isArray(editedMsgs[0].metadata?.edit_history), 'Edit: edit_history array exists')
assert(editedMsgs[0].metadata?.edit_history.length === 1, 'Edit: edit_history has 1 entry')
assert(editedMsgs[0].metadata?.edit_history[0].text === 'original text', 'Edit: edit_history preserves original text')

// Edit non-existent message
const notFound = store.updateMessage(editConvId, 'nonexistent', 'new text')
assert(notFound === false, 'updateMessage returns false for non-existent message')

// ─── T-002: React test ────────────────────────────────────────
console.log('\n── T-002: Emoji Reaction ──')

const reactConvId = 'test_conv_react'
const reactMsgId = 'test_msg_react_001'

store.appendMessage({
  message_id: reactMsgId, conversation_id: reactConvId,
  agent_id: 'agent-alpha', role: 'user', text: 'react to me',
  channel: 'agentgate', channel_user_id: 'agent-alpha',
  timestamp: new Date().toISOString(), metadata: {},
})

// Add reactions
store.addReaction(reactConvId, reactMsgId, '👍', 'agent-beta')
store.addReaction(reactConvId, reactMsgId, '👍', 'agent-gamma')
store.addReaction(reactConvId, reactMsgId, '❤️', 'agent-beta')

const reactMsgs = store.getMessages(reactConvId)
const reactions = reactMsgs[0].metadata?.reactions
assert(reactions !== undefined, 'React: reactions field exists')
assert(reactions['👍'].length === 2, `React: 👍 has 2 agents (got ${reactions['👍']?.length})`)
assert(reactions['👍'].includes('agent-beta'), 'React: agent-beta reacted 👍')
assert(reactions['👍'].includes('agent-gamma'), 'React: agent-gamma reacted 👍')
assert(reactions['❤️'].length === 1, `React: ❤️ has 1 agent (got ${reactions['❤️']?.length})`)

// Duplicate reaction (same agent, same emoji) — should not double-count
store.addReaction(reactConvId, reactMsgId, '👍', 'agent-beta')
const reactMsgs2 = store.getMessages(reactConvId)
const reactions2 = reactMsgs2[0].metadata?.reactions
assert(reactions2['👍'].length === 2, 'React: duplicate reaction not added')

// Reaction on non-existent message
const reactNotFound = store.addReaction(reactConvId, 'nonexistent', '🔥', 'agent-alpha')
assert(reactNotFound === false, 'addReaction returns false for non-existent message')

// ─── Conversation index ────────────────────────────────────────
console.log('\n── Conversation Index ──')

const convs = store.listConversations()
assert(convs.length === 3, `3 conversations (got ${convs.length})`)

const dedupConv = convs.find(c => c.conversation_id === convId)
assert(dedupConv.message_count === 1, 'Dedup conversation: message_count = 1')

// ─── Cleanup ───────────────────────────────────────────────────
try { rmSync(BASE_DIR, { recursive: true }) } catch {}

console.log(`\n${'='.repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed === 0) {
  console.log('🎉 Phase 0 verification PASSED')
  process.exit(0)
} else {
  console.error('💥 Phase 0 verification FAILED')
  process.exit(1)
}
