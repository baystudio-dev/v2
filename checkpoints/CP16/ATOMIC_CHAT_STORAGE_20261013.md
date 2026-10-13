# CP16: atomic chat snapshots and explicit storage failures

## Baseline and isolation
- Based on PR #1 head `bec097207da5e653880ef266a7aa5b0a311b6f2c`, following the acknowledged-write persistence gate (CI 38369849285).
- Isolated worktree `/home/sprite/v2-atomic-chat-20261013`, branch `qa/cp16-atomic-chat-20261013`.
- Pre-existing PTY/CMake work in `/home/sprite/v2-cp16-gh-publish-1009` is not part of this change; its dirty files were fingerprinted before work.
- No UI, Kotlin/C++, JNI library, dependency version, authentication, or workflow-permission changes. The existing Gradle `agent/` packaging rule includes the new module.

## Code changes
### Atomic storage protocol
`agent/atomic-chat-store.js` replaces direct writes to canonical `chat_data.json` with:
1. Validate the serialized snapshot before touching disk.
2. Create a randomly named sibling temporary file exclusively, permission 0600.
3. Write all bytes, correctly handling short writes. Flush the file and close it.
4. Atomically rename within the same directory, without a direct-write fallback.
5. Flush the parent directory before normal success is returned.

The helper rejects non-regular/linked canonical files and a symlinked final parent directory on write. It deletes only its own temporary file on a caught pre-commit failure. A SIGKILL may leave a private temporary file, but it is never loaded or promoted on restart. Multi-process locking and hostile same-UID directory replacement are not claimed.

### Truthful backend behavior
- `saveChatData()` no longer swallows save errors. Before rename, failure restores all persisted in-memory fields from the last committed serialized snapshot. Failed new chat messages do not produce successful message SSE events.
- Storage failure pauses automatic chat scheduling; the backend does not automatically retry a mutation or invoke models to fix it.
- HTTP catch boundaries return safe typed errors: 507 for quota/full storage, otherwise 503. Error responses contain no original system exception path or transcript.
- If rename succeeds but directory fsync fails, the new complete file remains canonical. The response is `CHAT_STORAGE_COMMIT_UNCERTAIN`, with `committed=true`, no retry recommendation, and reconciliation required. Memory is not dishonestly rolled back to older disk contents.
- Subsequent mutations in that process are blocked with `CHAT_STORAGE_RECONCILIATION_REQUIRED` until reload/reconciliation; reads retain the complete committed state.
- Invalid/unreadable existing history is preserved, not silently turned into a writable empty database. Chat/SSE reads return an explicit 503; `/api/status.chatStorage` reports unavailable/read-only state.
- Normal successful snapshots preserve the legacy JSON shape and unknown top-level fields. No schema migration or new database dependency.

## Verified local tests
**67/67 baseline tests PASS**, including all previous 43 tests and 24 new storage tests. Log: `/home/sprite/cp16-atomic-chat-baseline-20261013.log`.

Seventeen atomic-file tests cover correct flush/rename order and 0600 mode; failed directory open, temporary open, partial ENOSPC write, zero-progress write, file fsync, close and rename; short UTF-8 writes; post-rename directory sync failure; corrupt history, unsafe links and orphan temps; and actual child-process SIGKILL at four write boundaries.

Seven real backend HTTP tests cover injected ENOSPC/EIO/EACCES paths, rollback of RAM and preservation of canonical bytes, no false success or message SSE, explicit retry after storage recovery, no provider invocation, committed-but-uncertain responses and duplicate-write blocking, and corrupt-startup read-only preservation. They exercise `/api/internal/chat-message`, `/api/message`, `/api/config`, and `/api/clear` failure boundaries.

The ENOSPC/EIO/EACCES tests deliberately inject syscall failures into a **disposable test child** with real files. They do not fill the user's disk or a physical device. No test-only fault setting is exposed in the production server or HTTP API.

## Runtime verification
- Fresh Android API 36 emulator and CI: **PENDING**. Local Linux success is not Android validation.
- Physical ARM64, Windows and non-local/network filesystems: **NOT TESTED**.

## Important boundaries
- Atomic replacement is a **single snapshot** operation, not an all-or-nothing transaction across an HTTP route with multiple saves, attachment files, external tools, or model calls.
- The design assumes one backend process owns a local chat file. It does not add cross-process serialization or protect against two independent servers overwriting the same file.
- Actual abrupt process termination is tested. Real sudden-power-loss, failing flash hardware, kernel failure, and a physically full Android filesystem are not tested. fsync guarantees depend on the filesystem and storage device.
- Filesystems that cannot synchronize directory descriptors fail explicitly; no silent durability downgrade. Windows compatibility remains an open validation item.
- Orphan temporary files after uncatchable termination are ignored, not automatically promoted or indiscriminately deleted. A bounded housekeeping policy is separate follow-up work.
- The backend keeps one serialized rollback snapshot and still performs synchronous writes; very large histories and latency under slow/full flash are not benchmarked here.
- Room authentication/authorization, live agent execution and physical ARM64 remain separate gates. PR stays draft; main is unchanged.

## Primary API references
These inform the implementation; they are not substitutes for the test evidence above.
- Node.js v24 filesystem documentation: https://nodejs.org/docs/latest-v24.x/api/fs.html
- Linux rename atomic replacement semantics: https://man7.org/linux/man-pages/man2/rename.2.html
- Linux fsync and the separate parent-directory synchronization requirement: https://man7.org/linux/man-pages/man2/fsync.2.html
