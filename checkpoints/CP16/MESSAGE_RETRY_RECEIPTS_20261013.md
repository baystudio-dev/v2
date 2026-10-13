# CP16: opt-in durable message retry receipts

## Baseline and isolated scope
- Based on PR #1 head `54a04822581ce84dfe31ff2ef202fbc98a14c01b`, following atomic chat storage CI 38394270851.
- Worktree `/home/sprite/v2-message-retry-20261013`, local branch `qa/cp16-message-retry-20261013`.
- The original PTY/CMake worktree was fingerprinted before work: 37 dirty/untracked files were present. It is not reset, edited or included.
- No UI, Android Kotlin/C++, JNI binary, dependency version, workflow permission or live provider changes.

## API contract
This is an **opt-in append-only retry contract** for the existing `POST /api/internal/chat-message` endpoint, not a claim that every chat send or agent job is exactly-once.

A caller must retain the same `idempotencyKey` (8-128 ASCII letters, digits, hyphens or underscores) and identical semantic payload across retries. The caller must explicitly provide `sender: "user"` and `triggerTurn: false`, targeting `group`, `direct_budi` or `direct_rian`. Supported payload kinds are `chat` and `voice_note`. Existing unkeyed callers retain their previous behavior, including their previous duplicate-request risks. No UI client is automatically changed to send a key.

Example body:
```json
{
  "idempotencyKey": "caller-persisted-uuid-or-token",
  "chatId": "group",
  "sender": "user",
  "text": "Example message",
  "triggerTurn": false
}
```

- First accepted append returns the normal message plus `idempotency.replayed=false`.
- Identical scoped retry returns the existing message with `idempotency.replayed=true`. It performs no new snapshot write, message SSE broadcast, auto-compaction, model call or scheduled task.
- Reusing a key with different normalized content returns **409 CHAT_IDEMPOTENCY_CONFLICT**, without revealing the previous message.
- A receipt whose message was cleared returns **410 CHAT_IDEMPOTENCY_MESSAGE_GONE**. It never resurrects deleted chat. An edited message produces **409 CHAT_IDEMPOTENCY_MESSAGE_CHANGED** rather than silently returning different content as the original result.
- Keyed requests that would trigger model work, peer routing or unsupported rooms are rejected before mutation. Agent/tool execution still requires a separate durable execution journal.
- This is **not authentication**: sender is still a legacy client-declared field, and the existing endpoint has no new principal-authentication layer. Room-scoped key hashing is deduplication, not an authorization boundary.

## Persistence and failure behavior
- `agent/message-receipts.js` normalizes the bounded payload and computes a SHA-256 scoped-key hash and canonical payload fingerprint. It stores hashes, room/sender and the message ID, not a second message-body copy or the raw client key.
- The additive `messageReceipts` field is persisted in **the same atomic snapshot** as the appended message. Existing snapshots without it remain valid.
- Pre-rename storage failure rolls both the message and receipt back. A caller's explicit retry after storage recovery creates one message.
- After rename/directory-sync uncertainty, the existing reconciliation block remains enforced. Reload reads the committed message and receipt together, allowing an explicit identical retry to resolve to the old message instead of appending again.
- A malformed receipt ledger makes storage unavailable/read-only rather than silently dropping deduplication evidence.
- Capacity is bounded at **2048 receipts per database**. There is no silent expiry or eviction. At capacity, new keyed appends return **503 CHAT_IDEMPOTENCY_CAPACITY**, retryable=false; existing matching receipts remain usable. Ordinary unkeyed routes are not capped by this ledger. Safe retention/migration is a separate follow-up, so this opt-in protocol is not yet suitable for unlimited-duration deployment.
- The single Node backend's synchronous snapshot path serializes these appends. This is not a multiprocess lock, distributed transaction, protection against external file edits, or guarantee across rollback to a pre-receipt backup.

## Tests before publication
- Local baseline: **84/84 PASS**, including all previous 67 tests and 17 new tests.
- Seven pure-module tests cover canonical payload ordering, room key scope, bounded validation, unsupported triggered/peer/private routes, defensive replay, deleted/edited data, legacy/corrupt receipt schema, and capacity without evidence eviction.
- Ten real-backend HTTP tests cover retries and concurrent first submissions, restarts, conflict/redaction, pre-commit ENOSPC rollback, post-commit directory-sync uncertainty, retained tombstones, old-client compatibility and invalid/corrupt states.
- One of those tests sends a real request then **SIGKILLs the disposable Node process after directory fsync but before its HTTP acknowledgement**. Restart and retry return the original ID with one persisted message, one receipt and one commit. This is actual process termination; syscall faults remain test-only injected adapters.
- The shared Android/desktop persistence probe now uses three keyed messages and two legacy unkeyed messages. After the existing new-PID restart gate it retries the three keyed requests, compares exact original message objects and verifies the full room histories remain unchanged.
- Required new Android marker: `CP16_MESSAGE_RETRY_REPLAY_PASS count=3`.
- Android emulator outcome: **PASS in CI 38399249491** on the exact source below. This is based on the actual replay marker, not inferred from desktop tests.

## Preserved limits
No live agents, authenticated room privacy, attachment transactions, E2EE, power-cut/flash durability, multiprocess writers, PTY/IME or physical ARM64 runtime were validated. The new protocol does not auto-retry any mutation, and it does not claim exactly-once side effects beyond this keyed inert append path. PR remains draft; main stays unchanged.

## Primary references
- HTTP retry semantics, especially the warning against blind retries of non-idempotent requests: https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2
- Node.js SHA-256 hashing API: https://nodejs.org/download/release/v24.21.0/docs/api/crypto.html#cryptocreatehashalgorithm-options
These inform the design; the repository tests and actual CI markers remain the runtime evidence.

## First CI attempt: existing ELF-tool deadline
- CI 38398293447 desktop job executed all 17 new retry tests successfully, but the older native dependency test failed with `spawnSync nm ETIMEDOUT` at its 4000 ms deadline. The desktop result was **83/84**, not a green full pipeline.
- Increased only the native inspection subprocess deadline to 15000 ms. All pinned hashes, dependency, symbol and LOAD-alignment assertions remain mandatory. No binary changed, no failed test skipped, and this is not a claim of a 15-second runtime performance target.
- The full corrected revision needs a fresh CI result before being declared verified.

## Verified corrected CI result
- **CI 38399249491 PASS, all four jobs.** https://github.com/bayurohmat608-create/v2/actions/runs/38399249491
- Verified application/test source: `0e9bcc5040f8260bd7021327d5dcdd0953ff71fb`.
- Desktop CI: **84/84 PASS**, including every old test, all 17 new receipt/retry tests, the real post-commit/pre-ack SIGKILL test, and the native ELF checks that timed out in the earlier attempt.
- Android API 36 x86_64: `CP16_MESSAGE_RETRY_REPLAY_PASS count=3`, `CP16_CHAT_PERSISTENCE_PASS count=5` and `CP16_ANDROID_CHAT_PERSISTENCE_PASS`. Three keyed requests were repeated after app/engine restart and returned their original message objects; the full five-message histories stayed unchanged.
- Production PRoot remains green: `CP17_PROOT_PRODUCTION_READONLY_SMOKE_PASS`.
- Existing terminal/PRoot instrumentation remains green: `OK (4 tests)` and `CP18_PROOT_MANAGER_AND_TERMINAL_INSTRUMENTATION_PASS`.
- Android ARM64 and x86_64 builds/lint/ZIP alignment passed. This does **not** establish runtime correctness on physical ARM64.
- Raw verification logs retained under `/home/sprite/v2-message-retry-evidence-38399249491`; no transcript artifact was added to GitHub uploads.
- Original PTY/CMake work was re-fingerprinted: all 37 dirty/untracked files and Git status remained byte-identical. The new worktree is separate.

## Next integration boundary
No existing UI sender has been changed to persist and reuse an idempotency key. The tested opt-in endpoint handles inert owner chat appends only; `/api/message`, triggered model/tool work, and other mutating APIs do not acquire this guarantee. The 2048-receipt no-eviction cap, safe retention/migration and real authenticated client integration need separate design and tests before general deployment. No blind auto-retry has been introduced.
