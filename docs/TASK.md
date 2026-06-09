# AgentGate Task Board

> Tracks implementation tasks derived from [ISSUES.md](./ISSUES.md) and [PLAN.md](./PLAN.md).
> Status: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` wontfix

---

## Phase 0 — Critical Patch (v0.1.1)

### T-001: Implement `edit_message` handler

- **Bug:** BUG-01
- **File:** `src/mcp_server.ts` (handler), `src/storage/conversation_store.ts` (update method)
- **Status:** [x]
- **Effort:** S

**Steps:**

1. Add `updateMessage(convId: string, messageId: string, text: string)` to `ConversationStore`:
   ```typescript
   updateMessage(convId: string, messageId: string, text: string): boolean {
       const messages = this.loadMessages(convId)
       const msg = messages.find(m => m.message_id === messageId)
       if (!msg) return false
       msg.text = text
       msg.metadata = { ...msg.metadata, edited: true, edited_at: new Date().toISOString() }
       this.saveConversation(convId, messages)
       return true
   }
   ```
2. Rewrite `edit_message` handler to:
   - Find the most recent message in `convId` where `channel_user_id === config.server.defaultAgent`
   - Call `conversationStore.updateMessage(convId, msg.message_id, args.text)`
   - Return result with edited text for confirmation
3. Add unit test in `tests/unit/conversation_store.test.ts`

---

### T-002: Implement `react` handler

- **Bug:** BUG-02
- **File:** `src/mcp_server.ts`
- **Status:** [x]
- **Effort:** S

**Steps:**

1. Define reaction data structure in `MessageRecord.metadata`:
   ```typescript
   reactions?: Record<string, string[]>  // emoji → [agent_id, ...]
   ```
2. In `react` handler:
   - Load conversation messages for `args.conv_id`
   - Find the most recent message
   - Append current agent_id to `msg.metadata.reactions[args.emoji]` (or create entry)
   - Save and return confirmation
3. Add unit test

---

### T-003: Deduplicate `appendMessage`

- **Bug:** BUG-03
- **File:** `src/storage/conversation_store.ts:115`
- **Status:** [x]
- **Effort:** S

**Steps:**

1. In `appendMessage`, add guard before `messages.push(msg)`:
   ```typescript
   if (messages.some(m => m.message_id === msg.message_id)) {
       console.warn(`[ConversationStore] Skipping duplicate message: ${msg.message_id}`)
       return
   }
   ```
2. Verify: after fix, 2-message conversation has exactly 2 records
3. Add unit test with two appends of same message_id → only one stored

---

## Phase 1 — Data Integrity (v0.2.0)

### T-004: Atomic file writes

- **Bug:** BUG-04
- **File:** `src/storage/conversation_store.ts` (`saveConversation`)
- **Status:** [x]
- **Effort:** M

**Steps:**

1. Rewrite `saveConversation`:
   ```typescript
   saveConversation(convId: string, messages: MessageRecord[]): void {
       const tmpPath = this.convPath(convId) + '.tmp'
       writeFileSync(tmpPath, JSON.stringify(messages, null, 2))
       renameSync(tmpPath, this.convPath(convId))
   }
   ```
2. Add retry wrapper (max 3 attempts, 50ms backoff)
3. Verify: kill process mid-write → file is either old (complete) or new (complete), never partial

---

### T-005: `syncedIds` memory cap

- **Bug:** BUG-04 (related)
- **File:** `src/storage/conversation_sync.ts`
- **Status:** [x]
- **Effort:** S

**Steps:**

1. Cap `syncedIds` Set at 10,000 entries
2. When exceeded, evict oldest entries (convert to LRU: `Map<string, number>` with timestamp)
3. Log warning when eviction occurs

---

### T-006: Per-agent storage isolation

- **Bug:** BUG-04 (related)
- **File:** `src/storage/conversation_store.ts`, `src/mcp_server.ts`
- **Status:** [x]
- **Effort:** M

**Steps:**

1. Change `ConversationStore` base path from `~/.agentgate` to `~/.agentgate/<agent_id>`
2. Add migration: on startup, check for old-path conversations and move them
3. Update `ConversationSync` to handle the new path structure
4. Add unit test for migration path

---

## Phase 2 — Notification (v0.2.1)

### T-007: Research channel notification

- **Bug:** BUG-05
- **File:** Research task (no code changes initially)
- **Status:** [x]
- **Effort:** L

**Steps:**

1. Launch Claude with `--mcp-debug` and AgentGate, send a message, capture full MCP protocol log
2. Verify `notifications/claude/channel` JSON-RPC message appears on stdout
3. Compare with Telegram plugin: install via marketplace, capture its channel notification, diff the formats
4. Test `tengu_harbor_ledger` variations: `marketplace: "claude-plugins-official"` vs `"local"`
5. Test `--strict-mcp-config` flag impact on channel reception
6. Document findings in `docs/CLAUDE_COMMS.md` appendix

---

### T-008: Implement best-available push

- **Bug:** BUG-05
- **File:** `src/mcp_server.ts`
- **Status:** [x]
- **Effort:** M

**Steps:**

1. Based on T-007 findings, implement one of:
   - **A (ideal):** Fix channel notification config so `<channel>` blocks appear
   - **B (fallback):** Add auto-poll mechanism — a lightweight `list_conversations` call injected periodically
   - **C (manual):** Document the current pull-based workflow as intentional design
2. Add `AGENTGATE_PUSH_MODE` env var with values `channel|poll|off`
3. Update README with push notification configuration

---

## Phase 3 — Security (v0.3.0)

### T-009: MCP pairing tools

- **Bug:** BUG-06
- **Files:** `src/mcp_server.ts` (new tools), `src/auth/handshake.ts` (reuse)
- **Status:** [x]
- **Effort:** M

**Steps:**

1. Add `request_pairing` tool:
   - Calls `HandshakeManager.generatePairingCode(agentId)`
   - Returns 6-digit code with expiry timestamp
2. Add `verify_pairing` tool:
   - Calls `HandshakeManager.verifyPairingCode(code, peerAgentId)`
   - On success, writes to `~/.agentgate/verified_peers.json`
3. Add `list_peers` tool: shows all registered peers with verification status
4. Wire into Bridge: when `AGENTGATE_REQUIRE_PAIRING=true`, reject messages from unverified peers

---

### T-010: Registry shared secret

- **Bug:** BUG-06 (related)
- **File:** `src/bus/peer_bridge.ts`
- **Status:** [x]
- **Effort:** S

**Steps:**

1. Read `AGENTGATE_REGISTRY_SECRET` from env
2. If set, REGISTER message includes `signature: HMAC-SHA256(agent_id + ts, secret)`
3. Registry verifies signature before accepting registration
4. Reject with `register_nack` on mismatch

---

## Phase 4 — Polish (v0.4.0)

### T-011: Bump uuid dependency

- **Bug:** BUG-07
- **File:** `package.json:26`
- **Status:** [x]
- **Effort:** S

**Steps:**

1. `npm install uuid@latest` (currently ^13.x)
2. Verify: `uuid.v4()` API unchanged
3. Run test suite
4. `npm audit` → zero warnings

---

### T-012: Update documentation

- **Bug:** BUG-08
- **Files:** `README.md`, `docs/BRIDGE_PROTOCOL.md`, `docs/CLAUDE_COMMS.md`, `docs/DEBUG.md`, `docs/DIAGNOSTICS.md`
- **Status:** [x]
- **Effort:** S

**Steps:**

1. Replace `--dangerously-load-development-channels server:agentgate` → `--plugin-dir <path>` in all docs
2. Add Claude version compatibility table (v2.1.150+ → current approach)
3. Update Quick Start with verified steps (`.claude.json` config + `--plugin-dir`)
4. Add known limitation: channel push notification status per Claude version

---

### T-013: CLI health command

- **Bug:** BUG-11
- **File:** `src/index.ts` (new command)
- **Status:** [x]
- **Effort:** M

**Steps:**

1. Add `agentgate health` command to Commander CLI
2. Output sections:
   ```
   === Registry ===
   Status: connected | self-bootstrapped | disconnected
   Address: 127.0.0.1:8444

   === Peers (2) ===
   agent-alpha  @ 127.0.0.1:18445  connected  5m ago
   agent-beta   @ 127.0.0.1:18446  connected  3m ago

   === Messages ===
   Pending: 0
   Retry queue: 0

   === Storage ===
   Conversations: 1  Messages: 2  Size: 1.5 KB
   ```
3. Add `--json` flag for machine-readable output
4. Add smoke test in `tests/unit/`

---

### T-014: Edit history tracking

- **Bug:** BUG-10
- **File:** `src/storage/conversation_store.ts` (`MessageRecord`, `updateMessage`)
- **Status:** [x]
- **Effort:** M

**Steps:**

1. Extend `MessageRecord`:
   ```typescript
   edited?: boolean
   edited_at?: string
   edit_history?: Array<{ text: string; edited_at: string }>
   ```
2. In `updateMessage`, push current text + timestamp to `edit_history` before overwriting
3. `list_conversations` output: append `(edited)` when `edited === true`
4. Add unit test for multi-edit history

---

### T-015: Agent ID resolution cleanup

- **Bug:** BUG-09
- **File:** `src/mcp_server.ts` (startup section)
- **Status:** [x]
- **Effort:** S

**Steps:**

1. Add deprecation warning when agent_id comes from file:
   ```
   [AgentGate] Reading agent_id from ~/.agentgate/agent_id is deprecated.
   Use --agent-id ${AGENTGATE_DEFAULT_AGENT} in ~/.claude.json instead.
   ```
2. Schedule file-reading path removal for v0.5.0
3. Update README to document the `--agent-id` approach only

---

## Quick Reference

| Task | Phase | Bug | Effort | Status |
|------|-------|-----|--------|--------|
| T-001 | 0 — Critical | BUG-01 `edit_message` no-op | S | [ ] |
| T-002 | 0 — Critical | BUG-02 `react` no-op | S | [ ] |
| T-003 | 0 — Critical | BUG-03 Message duplication | S | [ ] |
| T-004 | 1 — Integrity | BUG-04 Atomic writes | M | [ ] |
| T-005 | 1 — Integrity | BUG-04 syncedIds cap | S | [ ] |
| T-006 | 1 — Integrity | BUG-04 Storage isolation | M | [ ] |
| T-007 | 2 — Notify | BUG-05 Channel research | L | [ ] |
| T-008 | 2 — Notify | BUG-05 Push implementation | M | [ ] |
| T-009 | 3 — Security | BUG-06 Pairing tools | M | [ ] |
| T-010 | 3 — Security | BUG-06 Registry secret | S | [ ] |
| T-011 | 4 — Polish | BUG-07 uuid bump | S | [ ] |
| T-012 | 4 — Polish | BUG-08 Docs update | S | [ ] |
| T-013 | 4 — Polish | BUG-11 Health CLI | M | [ ] |
| T-014 | 4 — Polish | BUG-10 Edit history | M | [ ] |
| T-015 | 4 — Polish | BUG-09 agent_id cleanup | S | [ ] |

**Total tasks:** 15 · **S:** 8 · **M:** 5 · **L:** 2 · **Phase 0 critical path:** T-001 → T-002 → T-003
