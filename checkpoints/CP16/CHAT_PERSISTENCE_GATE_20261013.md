# CP16: synthetic chat persistence after hard restart

## Scope and baseline
- Baseline PR #1 head: `6db00b10bafc9ca1e7bcdb038096b24fa2f14d3a`.
- The repository is ahead of the older in-chat PRoot investigation. Production x86_64 PRoot and four pipe-backed terminal lifecycle instrumentation tests have already passed; see `../CP19/TERMINAL_LIFECYCLE_PASS_38281669512.md`.
- Work happens in isolated worktree `/home/sprite/v2-chat-persistence-20261013`, branch `qa/cp16-chat-persistence-20261013`.
- Pre-existing PTY/CMake work in `/home/sprite/v2-cp16-gh-publish-1009` is deliberately untouched. No runtime, native binary, UI, or main-branch changes.

## Implemented gate
- Shared Python probe sends **five synthetic owner messages** through the existing `/api/internal/chat-message` endpoint with `triggerTurn=false`.
- Covers group, direct Budi, direct Rian, UTF-8/multiline text, quoted reply metadata, voice-note metadata, and exact message IDs/order/fields.
- Verification compares the full before/after message objects and unrelated room history. Lost, duplicated, modified or moved messages must fail.
- Desktop integration boots the actual `server.js` in temporary copied storage, kills it with SIGKILL and restarts **three times**. Existing context memory and custom room content are also checked on disk. A process tripwire rejects provider invocation; the child does not inherit API credentials.
- Android CI seeds before the existing force-stop/relaunch gate and verifies after new UI/engine PIDs and backend health, **before** the separate instrumentation stage reinstalls the test APK.
- Android fixture writes require both `GITHUB_ACTIONS=true` and emulator `ro.kernel.qemu=1`. No physical-device target is accepted by this new fixture gate.
- Expected transcript proof has file mode 0600 under runner temporary storage, is not uploaded as an artifact, and is deleted by the existing EXIT trap. The probe rejects redirects, proxies and non-loopback URLs.
- Existing GitHub desktop job invokes `npm test`. That script now also executes `qa:baseline`; previously the growing Node contract suite was only a local gate. No workflow-permission change needed.

## Verification status before publication
- Real desktop restart probe: PASS, three hard restarts, five acknowledged synthetic messages preserved, unrelated rooms/context unchanged.
- Eight Python negative-control tests: PASS (loss, duplicate, wrong room, changed quote, unrelated room, unexpected private room, exact snapshot and loopback validation).
- Full local baseline: **43/43 PASS**, with the eight Python negative controls run inside one of the Node integration tests. QA log: `/home/sprite/cp16-persistence-baseline-20261013.log`.
- Android emulator persistence: **PENDING fresh CI**, not inferred from desktop success.

## Explicit limits
- This tests persistence after acknowledged writes, not sudden power loss or termination halfway through a filesystem write. Current `saveChatData()` still uses direct synchronous JSON writes and logs save failures; this gate is not an atomic-write/durability proof.
- This is legacy chat storage, not proof of authenticated per-room authorization, cross-agent privacy, encryption, live model execution, or rich-media playback.
- No PTY/IME/UI interactions or physical ARM64 testing performed here. PR remains draft; the whole CP16 remains partial.

## Supporting command semantics
Android Developers, ADB activity-manager reference: https://developer.android.com/tools/adb#am

## Verified Android and desktop CI result
- **Run 38369849285: all four jobs PASS.** https://github.com/bayurohmat608-create/v2/actions/runs/38369849285
- Tested application/test source commit: `628a0c36feaee4c85be8f64e4602f3d4fefae11b`.
- Desktop CI actually executed the new baseline suite: **43 tests, 43 pass, 0 fail**. This includes the actual server process's three SIGKILL restarts and the eight negative controls.
- Android API 36 x86_64: `CP16_CHAT_PERSISTENCE_SEEDED count=5`, followed by cold restart with new UI PID 2709 and engine PID 2761, then `CP16_CHAT_PERSISTENCE_PASS count=5` and `CP16_ANDROID_CHAT_PERSISTENCE_PASS`.
- Production PRoot remained green: `CP17_PROOT_PRODUCTION_READONLY_SMOKE_PASS`.
- All four existing PRoot/terminal lifecycle instrumentation tests also remained green: `OK (4 tests)` and `CP18_PROOT_MANAGER_AND_TERMINAL_INSTRUMENTATION_PASS`.
- Android ARM64 and x86_64 build/lint/ZIP alignment jobs both passed. **ARM64 device runtime is still NOT TESTED**, not inferred from the ARM64 build.
- No source changes to `server.js`, native/runtime Kotlin/C++, JNI binaries, or UI were made in this checkpoint.
- Pre-existing uncommitted PTY work was preserved in its original worktree; only the new persistence worktree is clean.

### Next unverified reliability boundary
The successful gate demonstrates survival of completed/acknowledged writes across process termination. It does not demonstrate an interrupted write, full-disk behavior, or power-loss durability. The direct-write/error-swallowing behavior noted above remains a separate reliability issue for a later implementation checkpoint. No claim of end-to-end private-room authorization or live agent execution is made.
