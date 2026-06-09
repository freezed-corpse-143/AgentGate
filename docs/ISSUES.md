# AgentGate Issues & Bug Catalog

> Compiled from end-to-end testing on 2026-06-09 with Claude Code v2.1.169.
> Tests: dual tmux session, agent-alpha ↔ agent-beta, Bridge v2 P2P.

---

## Severity Legend

| Label | Meaning |
|-------|---------|
| 🔴 critical | Data loss, silent failure, user thinks operation succeeded but it didn't |
| 🟡 high | Functional degradation, duplicate data, no workaround |
| 🟠 medium | Missing feature, poor UX, no impact on core message delivery |
| 🟢 low | Cosmetic, documentation drift, future improvement |

---

## 🔴 Critical

### BUG-01: `edit_message` is a no-op

**File:** `src/mcp_server.ts` (compiled: `dist/mcp_server.js:228-229`)

**Symptom:** Calling `edit_message` returns success (`"edited conv_xxx"`) but the message text in the conversation store is never updated.

**Root cause:** The handler only calls `drainPending()` with a hardcoded string. Neither `args.conv_id` nor `args.text` is used to locate and update the message record.

```javascript
// Current (broken):
case 'edit_message':
    return { content: [{ type: 'text', text: drainPending(`edited ${args.conv_id}`) }] };

// Missing:
//   1. Load messages for args.conv_id
//   2. Find the most recent message sent by this agent
//   3. Update its text and set an "edited" flag
//   4. Persist via conversationStore.saveConversation()
```

**Impact:** User edits a message, sees a success response, but the edit is silently discarded. Conversation partner never sees the edit.

**Discovery:** Confirmed via `cat ~/.agentgate/conversations/conv_*.json` after an edit operation — message text unchanged, no `edited` metadata flag present.

---

### BUG-02: `react` is a no-op

**File:** `src/mcp_server.ts` (compiled: `dist/mcp_server.js:226-227`)

**Symptom:** Calling `react` returns success (`"reacted 👍"`) but the reaction is never stored.

**Root cause:** Same pattern as BUG-01 — handler returns a hardcoded success string without touching the conversation store.

```javascript
// Current (broken):
case 'react':
    return { content: [{ type: 'text', text: drainPending(`reacted ${args.emoji}`) }] };
```

**Impact:** User believes they've acknowledged a message with a reaction. The reaction is lost.

---

## 🟡 High

### BUG-03: Message duplication in shared conversation store

**File:** `src/storage/conversation_store.ts:115` (`appendMessage`), `src/mcp_server.ts` (sender + receiver both call `appendMessage`)

**Symptom:** Each message appears twice in `~/.agentgate/conversations/conv_*.json`. A 2-message conversation has 4 JSON records.

**Root cause:** Both MCP Server instances share the same `~/.agentgate/conversations/` directory. The sender's tool handler calls `appendMessage()`, then the receiver's wildcard subscriber (`bus.subscribeWildcard('agent.*.inbound', ...)`) also calls `appendMessage()` on the same file. `appendMessage` has no deduplication check.

```
Message flow for a single send_message:
  1. agent-alpha: send_message handler → conversationStore.appendMessage(msg)  [write A]
  2. Bridge P2P → agent-beta: wildcard subscriber → conversationStore.appendMessage(msg) [write B]
  3. Same file, same message_id, two entries.
```

**Impact:** Inflated message counts, confusing conversation history, potential display issues.

**Proposed fix:** Add `message_id` deduplication to `appendMessage`:

```typescript
appendMessage(msg: MessageRecord): void {
    const messages = this.loadMessages(msg.conversation_id)
    if (messages.some(m => m.message_id === msg.message_id)) return  // ← dedup
    messages.push(msg)
    // ... rest of method
}
```

---

### BUG-04: No concurrency control on shared state directory

**File:** Implicit — `~/.agentgate/conversations/` and `~/.agentgate/ports/` accessed by multiple processes.

**Symptom:** Two MCP Server processes read/write the same JSON files without any locking or coordination.

**Root cause:** The design assumes each agent has its own state directory, but on a single machine `~/.agentgate/` is shared. File-level race conditions are possible (e.g., one process reads while another writes).

**Impact:** Potential for corrupted conversation files under concurrent access. Low probability but high severity if it occurs.

**Proposed fix:**
- Short-term: `ConversationStore` uses atomic write (write to temp file → rename)
- Long-term: Per-agent subdirectory (`~/.agentgate/<agent_id>/conversations/`) with cross-process sync via Bridge

---

## 🟠 Medium

### BUG-05: `notifications/claude/channel` push does not work

**File:** `src/mcp_server.ts` (channel notification section)

**Symptom:** MCP Server correctly sends the JSON-RPC notification via stdio, but Claude v2.1.169 does not display `<channel>` blocks in the session context.

**Root cause:** Investigated in `docs/CLAUDE_COMMS.md` §7. Likely causes:
1. `--plugin-dir` loaded plugins may not receive the same channel permissions as marketplace-installed plugins
2. Harbor ledger entry `marketplace: "local"` may not be recognized
3. Claude version gating

**Workaround:** Pull-based `pendingMessages` queue — messages appear appended to the next MCP tool response.

**Impact:** User must proactively call a tool (e.g., `list_conversations`) to discover new messages. No real-time notification.

---

### BUG-06: Handshake/pairing not exposed as MCP tools

**File:** `src/auth/handshake.ts` (exists), `src/mcp_server.ts` (no integration)

**Symptom:** The `HandshakeManager` provides `generatePairingCode()` and `verifyPairingCode()`, but these are only wired into the REST adapter. No MCP tools exist for CLI-based agent pairing.

**Impact:** Agents auto-connect through the Bridge without authentication. Any process on the same machine can register with the Registry.

**Proposed fix:** Add two MCP tools:
- `request_pairing` → generates a time-limited pairing code
- `verify_pairing` → accepts a pairing code to authenticate a peer

---

### BUG-07: `uuid` package deprecated

**File:** `package.json:26` — `"uuid": "^9.0.0"`

**Symptom:** `npm install` warns: `uuid@9.0.1: uuid@10 and below is no longer supported.`

**Impact:** No functional impact yet, but the package will stop receiving security updates.

**Fix:** Bump to `"uuid": "^13.0.0"` and verify no breaking API changes.

---

### BUG-08: Documentation references non-existent CLI flag

**Files:** `README.md`, `docs/BRIDGE_PROTOCOL.md`

**Symptom:** Documentation instructs users to run:
```
claude --dangerously-load-development-channels server:agentgate
```
This flag does not exist in Claude Code v2.1.169.

**Fix:** Replace with `--plugin-dir` approach and MCP server auto-discovery from `~/.claude.json`.

---

## 🟢 Low

### BUG-09: `agent_id` file delivery is redundant

**File:** `src/mcp_server.ts` (agent ID resolution)

**Symptom:** The MCP server reads agent ID from `~/.agentgate/agent_id` as a workaround for Claude not passing environment variables. However, the `--agent-id ${AGENTGATE_DEFAULT_AGENT}` in `~/.claude.json` now correctly resolves the env var.

**Impact:** Two competing mechanisms for agent ID. The file-based approach can leave stale values.

**Fix:** Deprecate file reading; rely solely on `--agent-id ${AGENTGATE_DEFAULT_AGENT}` via `~/.claude.json` config. Keep file reading as fallback for backward compatibility.

---

### BUG-10: Edit history not tracked

**File:** `src/storage/conversation_store.ts` — `MessageRecord` interface

**Symptom:** Even after BUG-01 is fixed, edits will overwrite the original text with no audit trail.

**Proposed fix:** Add optional fields to `MessageRecord`:
```typescript
interface MessageRecord {
    // ... existing fields ...
    edited?: boolean
    edited_at?: string
    original_text?: string
    edit_history?: Array<{ text: string; edited_at: string }>
}
```

---

### BUG-11: No CLI health-check command

**File:** N/A (missing feature)

**Symptom:** No built-in way to verify the Bridge network status, peer list, or message delivery health without writing ad-hoc probe scripts.

**Proposed fix:** Add `agentgate health` CLI command that:
- Prints registry status and peer list
- Tests P2P connectivity to each peer
- Reports message queue depth

---

---

### BUG-12: Edit and react changes not synced across agents

**File:** `src/storage/conversation_sync.ts` — `ConversationSync.handleLocalAppend`

**Symptom:** When agent-beta edits a message or adds a reaction, agent-alpha still sees the original text and no reaction. Edits and reactions are local-only.

**Root cause:** `ConversationSync` only broadcasts new message appends (`onAppend` → `handleLocalAppend`). It does not broadcast `updateMessage` or `addReaction` calls. The `onAppend` callback is the only event hook, and there's no `onEdit` or `onReaction` callback.

**Impact:** Cross-agent conversation history diverges. Agent A sees the original text; Agent B sees the edited version.

**Proposed fix:**
1. Add `onEdit` and `onReaction` callbacks to `ConversationStore`
2. Wire them into `ConversationSync` to broadcast edit/reaction events via `_system.conversation.sync`
3. On the receiving side, apply edits/reactions via `updateMessage`/`addReaction` with syncedIds guard

**Discovery:** Observed during tmux dual-instance testing (2026-06-09). Agent-beta's store showed `(EDITED)` flag; agent-alpha's store showed original text for the same conversation.

---

### BUG-13: Stale `agentgate-plugin/` subdirectory

**File:** `agentgate-plugin/` (removed)

**Symptom:** Project root had a redundant `agentgate-plugin/` subdirectory containing its own `.claude-plugin/plugin.json`, `dist/`, and `skills/` — a duplicate of the project root structure.

**Root cause:** The project was refactored in commit `73d1f97` ("refactor: flatten plugin structure — project root IS the plugin") but the old directory was never deleted from the working tree.

**Impact:** Confusing for contributors; could cause Claude to load duplicate plugin definitions.

**Fix:** Deleted `agentgate-plugin/`. Project root is the single source of truth with `.claude-plugin/plugin.json` at root level.

---

## Summary

| ID | Severity | Area | Effort | Status |
|----|----------|------|--------|--------|
| BUG-01 | 🔴 critical | `edit_message` no-op | S | ✅ fixed |
| BUG-02 | 🔴 critical | `react` no-op | S | ✅ fixed |
| BUG-03 | 🟡 high | Message duplication | S | ✅ fixed |
| BUG-04 | 🟡 high | Shared filesystem | M | ✅ fixed |
| BUG-05 | 🟠 medium | Channel push | L | 📋 documented |
| BUG-06 | 🟠 medium | Handshake MCP tools | M | ✅ fixed |
| BUG-07 | 🟠 medium | uuid deprecation | S | ✅ fixed |
| BUG-08 | 🟠 medium | Docs drift | S | ✅ fixed |
| BUG-09 | 🟢 low | Redundant agent_id file | S | ✅ fixed |
| BUG-10 | 🟢 low | Edit history | M | ✅ fixed |
| BUG-11 | 🟢 low | Health check CLI | M | ✅ fixed |
| BUG-12 | 🟠 medium | Edits not synced | M | [ ] new |
| BUG-13 | 🟢 low | Stale agentgate-plugin/ | S | ✅ fixed |

**Key:** S = hours, M = days, L = weeks (research required)
