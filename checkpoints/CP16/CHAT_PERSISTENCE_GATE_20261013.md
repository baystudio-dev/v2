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
