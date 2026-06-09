# AgentGate Remediation Plan

> Based on issues cataloged in [ISSUES.md](./ISSUES.md). Each phase delivers independently shippable value.

---

## Phase 0: Critical Patch (v0.1.1)

**Goal:** Fix the two no-op tools that silently discard user data. Ship immediately.

### 0.1 Fix `edit_message` (BUG-01)

- [ ] Add message lookup by `conv_id` in `edit_message` handler
- [ ] Find most recent message sent by current agent in the conversation
- [ ] Update `text` field and set `edited: true` in metadata
- [ ] Persist via `conversationStore.saveConversation()`
- [ ] Return edited text in tool response for user confirmation

### 0.2 Fix `react` (BUG-02)

- [ ] Add `reactions` map to `MessageRecord.metadata` (emoji → [agent_id])
- [ ] In `react` handler, find target message, append `{emoji, agent_id, ts}` to reactions
- [ ] Persist and return confirmation with emoji

### 0.3 Add message deduplication (BUG-03)

- [ ] In `ConversationStore.appendMessage()`, check `message_id` before pushing
- [ ] If duplicate found, log warning and return early (no-op)

**Ship criteria:** All 85 unit tests pass + 3 new tests for edit/react/dedup. Manual verification via dual-instance Claude test.

---

## Phase 1: Data Integrity (v0.2.0)

**Goal:** Eliminate shared filesystem corruption risk and add persistence guarantees.

### 1.1 Atomic file writes (BUG-04)

- [ ] `saveConversation()` writes to `<conv_id>.json.tmp` first, then `fs.rename()` to final path
- [ ] Add retry logic (max 3 attempts) for `rename` failures
- [ ] Add file lock via `fs.mkdir('.lock')` pattern (atomic on most filesystems)

### 1.2 Conversation sync hardening

- [ ] Review `ConversationSync` for race conditions between local append and remote sync
- [ ] Add `syncedIds` maximum size cap with LRU eviction (prevent memory leak)
- [ ] Add sync sequence numbers for ordering guarantee

### 1.3 Per-agent storage isolation

- [ ] Change storage path from `~/.agentgate/conversations/` to `~/.agentgate/<agent_id>/conversations/`
- [ ] `ConversationSync` continues to handle cross-agent sync over Bridge
- [ ] Migration: detect old path and move files on startup

**Ship criteria:** Run 1000 concurrent send/reply iterations without corruption or data loss.

---

## Phase 2: Real-time Notification (v0.2.1)

**Goal:** Achieve real-time push notification for incoming messages.

### 2.1 Research channel notification path (BUG-05)

- [ ] Trace Claude v2.1.169 MCP notification handling via `--mcp-debug`
- [ ] Compare with Telegram plugin (marketplace) behavior — is `tengu_harbor_ledger` the gate?
- [ ] Test if `--strict-mcp-config` changes notification behavior
- [ ] Explore alternative: `system-reminder` injection via tool response

### 2.2 Implement best available push mechanism

- [ ] If channel notification can be made to work → document configuration requirements
- [ ] If not → implement polling-based background check via `list_conversations` auto-call pattern
- [ ] Add `AGENTGATE_PUSH_MODE` env var: `channel|poll|off`

**Ship criteria:** Message appears in partner Claude session within 5 seconds without manual tool call.

---

## Phase 3: Security (v0.3.0)

**Goal:** Add agent identity verification and pairing.

### 3.1 MCP pairing tools (BUG-06)

- [ ] Expose `request_pairing` MCP tool: generates 6-digit code, valid 5 minutes
- [ ] Expose `verify_pairing` MCP tool: accepts code, marks peer as verified
- [ ] Store verified peers in `~/.agentgate/verified_peers.json`
- [ ] Add optional `--require-pairing` flag to reject unverified peer connections

### 3.2 Registry authentication

- [ ] Add shared secret (`AGENTGATE_REGISTRY_SECRET`) for multi-machine Registry access
- [ ] REGISTER message includes HMAC signature when secret is configured

**Ship criteria:** Unverified agent cannot send messages when pairing is required. Verified agents pass through.

---

## Phase 4: Polish (v0.4.0)

**Goal:** Production-quality UX, documentation, and tooling.

### 4.1 Dependency hygiene (BUG-07)

- [ ] Bump `uuid` to ^13.0.0, verify no API breakage
- [ ] Run `npm audit fix` for the 1 moderate vulnerability
- [ ] Add `npm outdated` to CI pipeline

### 4.2 Documentation update (BUG-08)

- [ ] Replace all `--dangerously-load-development-channels` references with current approach
- [ ] Add troubleshooting section for Claude version compatibility
- [ ] Document `AGENTGATE_BRIDGE_HOST` usage with Tailscale IP addresses

### 4.3 CLI health command (BUG-11)

- [ ] Add `agentgate health` command
- [ ] Output: Registry status, peer list with latencies, pending message count, store size
- [ ] Support `--json` flag for scripting

### 4.4 Edit history (BUG-10)

- [ ] Add `edit_history` array to `MessageRecord`
- [ ] Each edit appends `{text, edited_at}` to history, updates `text` to latest
- [ ] `list_conversations` shows `(edited)` marker when `edit_history.length > 0`

### 4.5 Agent ID resolution cleanup (BUG-09)

- [ ] Deprecation warning when agent_id read from file (not CLI arg)
- [ ] Remove file-reading path in v0.5.0

**Ship criteria:** All documentation examples work on first try. `agentgate health` returns useful output. Zero `npm audit` warnings.

---

## Timeline

| Phase | Version | Est. Effort | Dependencies |
|-------|---------|-------------|--------------|
| 0 — Critical Patch | v0.1.1 | 1 day | None |
| 1 — Data Integrity | v0.2.0 | 3 days | Phase 0 |
| 2 — Notification | v0.2.1 | 1 week (research) | Phase 1 |
| 3 — Security | v0.3.0 | 3 days | Phase 1 |
| 4 — Polish | v0.4.0 | 2 days | Phases 0-3 |

**Total:** ~3 weeks to v0.4.0 (production-ready). Phase 0 can ship in 1 day.
