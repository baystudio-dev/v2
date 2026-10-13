# SESSION HANDOFF • WhatsApp Agent V2

## Latest continuation: local HTTP browser boundary (2026-10-13)
- Parent `8f52bb3`, isolated worktree `/home/sprite/v2-http-boundary-20261013`, local branch `qa/cp16-http-boundary-20261013`. Preserve original PTY/CMake WIP and do not merge main.
- New `agent/loopback-request-policy.js` validates peer/Host/Origin/Referer/Fetch Metadata, duplicate headers, request target and JSON POSTs before all handlers. Browser-simple POST and hostile Host/origin reflection were reproduced against the parent, then rejected by real backend tests.
- API payloads and errors are not logged. No web UI/native/provider changes. The old Android media type `application/json; utf-8` is narrowly retained.
- **CI 38406779812 PASS**, source `e993c4a0e0d7d0bd0e6aee07433636f122b4ebc9`: all four jobs; desktop 111/111; Android 13 rejected HTTP contexts, allowed same-origin/native controls, restart/replay, production PRoot and four instrumentation tests retained.
- Report: `checkpoints/CP16/LOCAL_HTTP_BOUNDARY_20261013.md`.
- Originless native/CLI access remains a deliberate compatibility exception, NOT auth. Local hostile apps, same-origin XSS, real browser attack automation, private-room auth, PTY, UI key persistence and physical ARM64 remain unverified. PR stays draft.


## Latest continuation: opt-in message retry receipts (2026-10-13)
- Based on `54a0482`, isolated worktree `/home/sprite/v2-message-retry-20261013`, local branch `qa/cp16-message-retry-20261013`. Original 37-file PTY/CMake WIP fingerprint preserved.
- `agent/message-receipts.js` adds bounded persistent idempotency for explicitly keyed user messages with triggerTurn=false in the three legacy rooms. No UI/agent wiring changed.
- Message and receipt share one atomic save/rollback boundary. Same-payload retries return the existing message without saving or broadcasting. Conflicts, edited/deleted messages, invalid ledgers and capacity fail explicitly.
- **CI 38399249491 PASS**, source `0e9bcc5040f8260bd7021327d5dcdd0953ff71fb`: all four jobs; desktop 84/84; Android keyed replay count=3 with five messages preserved, production PRoot and four instrumentation tests green. Actual post-commit/pre-ack SIGKILL is covered by desktop integration tests.
- Report: `checkpoints/CP16/MESSAGE_RETRY_RECEIPTS_20261013.md`.
- Receipt capacity 2048 with no silent eviction; auth, agent/tool execution, multiprocess writes, retention/migration, physical ARM64 and PTY remain separate gates. PR stays draft.


## Latest work: atomic chat storage (2026-10-13)
- Based on `bec0972`, isolated worktree `/home/sprite/v2-atomic-chat-20261013` on `qa/cp16-atomic-chat-20261013`. Preserve original PTY/CMake work; no native/UI edits in this checkpoint.
- New `agent/atomic-chat-store.js`: sibling 0600 temp, full write, fsync file, close, rename, fsync directory. Pre-rename failures roll persisted RAM back; post-rename sync uncertainty is reported and blocks blind retries.
- Corrupt startup history stays untouched/read-only. HTTP storage errors are typed/redacted, not success or generic malformed-request errors.
- **Green CI 38394270851**, source `cb1f84e3a09db8e28c219a11cd7d11b157aa640e`: 4/4 jobs, desktop 67/67, Android atomic-write/restart chat persistence, production PRoot and four terminal tests PASS. Power loss and actual full Android storage still untested.
- Report: `checkpoints/CP16/ATOMIC_CHAT_STORAGE_20261013.md`.


## Latest verified continuation: chat persistence (2026-10-13)
- Green run **38369849285**, tested source `628a0c36feaee4c85be8f64e4602f3d4fefae11b`: all four CI jobs PASS, desktop baseline **43/43**, Android chat persistence count=5 after force-stop/new PIDs, production PRoot and `OK (4 tests)` instrumentation retained.
- Report: `checkpoints/CP16/CHAT_PERSISTENCE_GATE_20261013.md`.
- New publication worktree: `/home/sprite/v2-chat-persistence-20261013` on `qa/cp16-chat-persistence-20261013`, pushed to PR #1's existing feature branch. Verify remote HEAD before further work.
- **Preserve** original worktree `/home/sprite/v2-cp16-gh-publish-1009`: its uncommitted CMake/PTY probe files were not touched or included. Do not reset or clean that worktree.
- Current remaining gates: partial-write/disk-error durability, real PTY and UI/IME, physical ARM64 runtime, authenticated room privacy and live agents. No main merge; PR remains draft.


## Wajib dibaca pertama kali saat sesi baru
1. Baca docs/BLUEPRINT_MASTER_V2.md untuk keputusan produk/arsitektur.
2. Baca docs/CHECKPOINT_TRACKER.md untuk 25 checkpoint dan setiap ✅ yang punya bukti.
3. Baca dokumen ini untuk branch, status, batas implementasi dan next task.
4. Baca checkpoints/CP18/PARITY_MATRIX.md sebelum mengubah frontend WA.
5. Lakukan status check, unit tests dan cek toolchain. **Jangan klaim Android-ready dari pengujian Node.**

## Lokasi dan branch
- Repository: https://github.com/bayurohmat608-create/v2
- Base pinned SHA: d3f74a4776d43acfa22f4a3ea2a73c7809d833dc
- Last verified parent implementation commit: a68f42291b4c4aa315bacb1ea0ede134c6a86281 (local originally).
- Worktree aktif tahap ini: /home/sprite/v2-checkpoints-20261008
- Working branch: feature/v2-blueprint-tracker-cp19-cp20-20261008
- Exclusive Sprite: bay-chat-agent-isolated-qa-1008 / sprite-542a3150-c1cc-4979-a784-af9a7a04a73d.
- Jangan sentuh, hentikan service, overwrite, atau reset Sprite lain.
- Worktree /home/sprite/v2-master-impl memuat file untracked dari pekerjaan lain; **jangan edit/hapus file di sana**.

## Sumber acuan
- Blueprint induk v2.0 berasal dari artefak user sebelumnya (2047 baris), direproduksi di docs/BLUEPRINT_MASTER_V2.md tanpa mendesain ulang UI.
- Sumber Droide adalah ZIP referensi read-only di /home/sprite/droide-reference/read-only, bukan source yang boleh diedit.
- Android V2 main saat bootstrap: d3f74a4. Main, source asli, dan PTY worktree lain tidak disentuh.

## Sudah diimplementasikan dan diuji pada branch ini
- ✅ CP00: baseline SHA dan empat source hashes; qa:baseline script.
- ✅ CP18 parsial: 26 item V1 parity inventory dan 15 source-symbol regression guards.
- ✅ CP19 parsial: Zovia persona, team registry, scoped helper, GET /api/team metadata, 409 when unsupported Zovia message.
- ✅ CP19 parsial: isolated PrivateRoomStore storage with 0600 file and 0700 parent dir, atomic staging/rename, read deny, idempotency, restart tests.
- ✅ CP20 parsial: structured action validation and pending registry; no execution or spoofed completion.
- Refer to exact tests in scripts/qa/; rerun them before editing statuses.

## BELUM siap (JANGAN centang penuh)
- Real Zovia conversation, room-scoped authenticated API, model/engine wiring, scheduler and proof-of-execution.
- CP20 real mention/delegate/share dispatch, persisted evidence and owner approval mechanism.
- Native Droide PTY integration to release source, Sora editor, LSP, Git, Ubuntu, Antigravity managed integration.
- Physical ARM64 device QA, chat/terminal interaction, full feature parity and long-running lifecycle; CI builds and x86_64 emulator startup/Node HTTP are now verified (run 37878367182).
- V2 legacy /api/chats and /api/events currently can surface Budi/Rian private messages to local UI; no Zovia messages are connected to those APIs.
- V2 frontend uses unverified E2EE wording in security banner. Do not repeat that as a real security property.

## Rencana checkpoint berikutnya
1. Complete CP19: server-authenticated principal identity and scoped per-room HTTP/SSE with room-store integration, backwards compatibility/migration tests.
2. CP19: integrate Zovia into chat and group UI once ACL is proven; do not change UX without user permission.
3. CP20: trusted action executor, idempotent event journal, real 'panggil Rian' group event, no fake DONE.
4. CP01/02: merge PTY from separately audited Droide QA worktree after verifying licenses/JNI and Android build.
5. Push commit on independent GitHub branch. Main stays untouched until review and Android gates.

## Exact repeatable tests
- npm run qa:baseline  (Node syntax + unit/HTTP contract tests)
- npm run test:contracts
- git diff --check
- For APK QA, require JDK17, matching Android SDK, Gradle, emulator/device; unavailable tests must be reported as BLOCKED, not PASS.

## Git/merge rules
- Never force push main and never overwrite another Sprite/worktree.
- Update docs/CHECKPOINT_TRACKER.md and this file in the SAME commit as each code change.
- Never mark checklist items done merely because a blueprint specifies them.
- Include source location, real test result, revision SHA, and rollback path in handoff.


## CP16 build admission continuation (2026-10-08)
- Active new worktree: /home/sprite/v2-build-qa-1008; branch feature/v2-android-build-admission-20261008.
- Toolchain is isolated at /home/sprite/v2-build-toolchain-1008: Temurin JDK17, Gradle 8.13, Google Android SDK36, Build Tools36, NDK27.0.12077973 and CMake3.22.1; official archive hashes matched.
- Historical main CI 37745673751 built ARM64 and x86_64 successfully but failed emulator smoke because /bin/sh rejected set -euo pipefail before the application started. This failure did NOT establish an application crash.
- Fixed CI smoke to POSIX set -eu, guarded by scripts/qa/android-ci-smoke-contract.test.js.
- 20/20 JavaScript backend, HTTP, and documentation tests passed; no APK success is claimed.
- Local Gradle build and workflow run 37775717356 on the older verified branch are in progress. A separate CI branch run will follow the fix.
- No other Sprite or worktree was modified; the main branch is untouched. Original rollback point: 0f3b81d.


## LATEST CP16 BUILD HANDOFF — 2026-10-08
- Worktree: /home/sprite/v2-build-qa-1008. Only Sprite bay-chat-agent-isolated-qa-1008, ID sprite-542a3150-c1cc-4979-a784-af9a7a04a73d. Never interfere with other sprites or worktrees.
- Remote CP16 branch prior fix: feature/v2-cp16-build-fix-20261008 @ 265473f1e312ea93c29f421d8f77fb9060978e07; local HEAD originally 83d1767. GitHub main unchanged.
- CI run 37778072039: Desktop, Android ARM64, x86_64 lintDebug and assembleDebug and zipalign succeeded. Emulator failed BEFORE app install. Runner executed each multiline YAML line via independent sh -c; variable APK was unavailable when test -f ran.
- New verified fix: YAML script now invokes a single bash scripts/qa/android-emulator-smoke.sh, keeping shell state and diagnostics. Mocked APK/ADB/HTTP success and failures tested; npm run qa:baseline 22/22 PASS.
- Local Sprite Gradle failed after 42m51s because Build Tools 35.0.0 absent and license not accepted. Separate from CI builds; JDK17 SDK36 BuildTools36 NDK27 CMake3.22.1 provisioned to /home/sprite/v2-build-toolchain-1008.
- Next task: push current CP16 fix to remote feature branch, dispatch CI, verify emulator backend reaches HTTP /api/status and logcat. Real Android app runtime NOT VERIFIED.
- Fly.io parked by user: flyctl v0.4.114 installed in /home/sprite/flyio-baystudio-cli, but Fly auth whoami was not authenticated. Sprite URL 502 was a missing web service, Sprite commands still work. Do not pursue auth now.
- Continue respecting V1 parity, no unapproved UI edits, strict private chat ACL, Antigravity policy gate. Source of truth docs/BLUEPRINT_MASTER_V2.md and docs/CHECKPOINT_TRACKER.md.

## CP16 run 37805223698 diagnosis (2026-10-09)
- CI Android ARM64/x86_64 + Desktop passed. Emulator APK install succeeded; MainActivity `am start -W` returned timeout; `/api/status` was unreachable for 90 attempts, causing smoke test exit 22. Not proof of a V2 Java/native crash.
- Original logcat began only after timeout; system Bluetooth/phone crashes are not clearly from our app. Evidence: checkpoints/CP16/RUNTIME_FAILURE_37805223698.md.
- CP16 smoke script now captures live logcat from before app launch and app/service diagnostics after failure, uses non-blocking start, and retains bounded retry with negative tests. `npm run qa:baseline` 22/22 passed locally.
- Next: push this diagnostic-only revision to separate feature branch, rerun CI, inspect app-scoped logcat, then fix actual startup if indicated. No V2 UI code changed.


## LATEST CP16 VERIFIED HANDOFF — 2026-10-09
- Active published branch `feature/v2-android-build-admission-20261008` on PR #1 (draft). HEAD `ef038faf1e245ef37703d521e69af655cf1fb032` at green CI run `37878367182`.
- Isolated Sprite `bay-chat-agent-isolated-qa-1008`, publication worktree `/home/sprite/v2-cp16-gh-publish-1009`. Preserve prior worktrees and `main`.
- **CI PASS:** Desktop, ARM64 and x86_64 build+APK alignment, Android 36 x86_64 emulator KVM, real installed MainActivity, embedded Node.js `/api/status` health on attempt 5.
- App-specific blocker was host Android resolving Alpine guest `/bin/sh -> /bin/busybox` incorrectly. Fixed by shared `RootfsShellValidator` used by WorkstationManager and PRootManager. Earlier `agent/` APK asset omission and KVM restrictions were also fixed.
- Evidence and verified APK SHA-256: `checkpoints/CP16/RUNTIME_PASS_37878367182.md`; `npm run qa:baseline` **26/26 PASS**.
- **Do not claim CP16 fully complete or app ready for release:** physical ARM64, real chat/terminal/UI testing, privacy auth E2E, model/engine provider tests and full native alignment remain pending.
- Next: obtain physical ARM64 test evidence and verify real chat, native terminal/PRoot, agent workflows, rollback/reopen, logs and permissions before merging PR #1.

## CP16 recovery QA extension (2026-10-09)
- After green Android 36 emulator startup run 37879056956, added a non-destructive second force-stop/relaunch, backend `/api/status` health probe and metadata-only `/api/team` schema gate to `scripts/qa/android-emulator-smoke.sh`.
- CI artifacts now include `runtime-restart-status.json` and `runtime-team.json`. This is deliberately NOT a real agent/PRoot/physical-device test.
- Local `npm run qa:baseline` 26/26 PASS; next verification is a fresh GitHub CI emulator run after publishing the new workflow and script.

## CP16 Android cold-restart failure diagnosis — 2026-10-09
- Run 37885599280: 3/4 CI jobs PASS; emulator startup passed on attempt 3 but restart gate failed with Bash exit **23** (HTTP service unavailable).
- Captured Android logs: force-stop correctly killed both UI and engine; immediate `am start` returned result code 3 / 'intent ... delivered to currently running top-most instance' WITHOUT starting a replacement process. This is evidence of a stale Activity/task relaunch race, not app crash.
- Follow-up script now polls both PIDs terminated, waits for task transition, invokes `am start -S --activity-new-task --activity-clear-task`, rejects warnings, and gates on fresh UI+engine PIDs and real HTTP response.
- `npm run qa:baseline` 28/28 PASS locally; fresh Android 36 CI pending. Report: checkpoints/CP16/RESTART_FAILURE_37885599280.md.
- Remain on isolated Sprite /home/sprite/v2-cp16-gh-publish-1009; no direct main, UI, or other Sprite changes.

## CP16 Android 36 CLI option correction
- Run 37887122479: Android 36 rejected `--activity-new-task` option in `am start` with `IllegalArgumentException`, giving script exit 26 before restart. No app crash claim.
- Replaced invalid flag with `-f 0x10008000` (NEW_TASK|CLEAR_TASK); retained `-S`, old-process stop wait and fresh PID/backend response proof.
- Unit mock explicitly rejects reintroducing `--activity-new-task`. Fresh CI validation pending.

## CP16 GitHub Actions KVM flake — 2026-10-09
- CI 37887560726: Desktop + ARM64/x86_64 build PASS; emulator preflight failed before boot because /dev/kvm device existed but lacked writable permissions after udev trigger.
- Only GitHub runner workflow was hardened: bounded permission checks and ephemeral runner-local `sudo chmod 0666 /dev/kvm` fallback. No app or UI changes.
- Restart smoke is STILL PENDING real CI verification. Local Node contracts should be rerun before further push.

## CP16 recovery verified — 2026-10-09
- **Green GitHub Actions run 37887912549**, source head `deb3177` (pre-documentation commit).
- Desktop, ARM64 build, x86_64 build and Android 36 emulator cold-restart smoke all **PASS**.
- App UI PID `2233→2684`; engine PID `2587→2736`; Node health responded after relaunch in 2 probes; read-only team metadata schema PASS.
- Evidence: `checkpoints/CP16/RESTART_PASS_37887912549.md` and CI artifact `android-runtime-smoke-evidence`.
- **Still pending:** physical ARM64 interactive device QA and full chat/terminal/agent execution, high-load/lifecycle tests, full native segment proof. CP16 stays **PARTIAL** and PR #1 remains draft.

## CP16 read-only Android HTTP integration extension
- New post-restart CI emulator smoke performs read-only GET `/api/chats`, GET `/api/workstation/status`, and confirms POST `/api/terminal/exec` is disabled (HTTP 409; no shell command execution).
- These gates do NOT call actual models, do NOT send chat messages, and do NOT persist chat history artifacts to GitHub. They validate endpoint schemas and an intentional security boundary.
- Local `npm run qa:baseline`: 28/28 PASS. Fresh emulator CI is required before marking this gate complete.
- Physical ARM64 and true terminal/PRoot interaction remain UNTESTED.

## CP16 read-only API runtime gate VERIFIED — 2026-10-09
- CI **37889374776** all 4 jobs PASS on source commit `c0af543`.
- Android 36 emulator: initial Node health, force-stop/relaunch Node health, read-only `/api/chats` and `/api/workstation/status`, HTTP `/api/terminal/exec` deliberate 409 deny all verified.
- Evidence: `checkpoints/CP16/READONLY_API_PASS_37889374776.md`.
- This is NOT proof of actual native PRoot command execution, persistent chat correctness or agent activity. Physical ARM64 still UNTESTED.

## CP16 Native PRoot emulator gate (pending evidence)
- Added scripts/qa/android-proot-smoke.sh: read-only Alpine BusyBox uname -m through APK native PRoot and loader as the app's debug UID via run-as, with 30-second timeout.
- Workflow invokes this fixed test after successful UI + Node cold restart and read-only API smoke. It does NOT expose arbitrary HTTP commands, require device root, or modify user chats.
- Local Node contract tests 29/29 PASS before emulator run; runtime PRoot result PENDING.
- Do not confuse this with full interactive terminal/PTY, real agent execution, chat persistence, or physical ARM64 tests.

## PRoot emulator evidence run 37890582657
- Desktop, both APK builds, Node startup/restart, read-only APIs PASS.
- New native PRoot smoke failed code 40 before command execution: emulator dumpsys package only reported legacyNativeLibraryDir=/data/app/.../lib and primaryCpuAbi=x86_64, not nativeLibraryDir.
- Corrected harness to derive native dir from legacyNativeLibraryDir + primaryCpuAbi, maintaining app UID and fixed read-only command. Local contract suite 29/29 PASS. Fresh CI PRoot result still PENDING.

## CP16 native PRoot run 37891194307
- Full CI: Desktop and two Android builds PASS; emulator initial health, cold restart and read-only API PASS.
- PRoot probe failed with code 41 after locating native .so binary: Android env reported `env: exec -0: No such file or directory`. The layered ADB shell command argument composition dropped the executable, not proof the PRoot ELF itself failed.
- Replaced nested adb/run-as/env command string with an immutable stdin-fed shell program via `adb shell run-as com.bossbayu.aiteam sh` to retain the binary path and arguments; 29/29 local tests PASS. Emulator validation pending.

## CP16 PRoot stdin probe 37891827332
- Desktop + ARM64/x86_64 APK build, Node startup/restart, read-only API guard PASS.
- PRoot app-UID shell command still failed with code 41 but no captured stderr/output; exact failure layer unknown.
- Added `adb shell -T` non-PTY and immutable diagnostic markers for run-as STDIN, app UID, native library presence, and Alpine BusyBox presence. This is a diagnostic gate only; Linux shell is NOT VERIFIED.
- Local test suite 29/29 PASS; fresh CI needed. PR remains draft, no main/UI modification.

## CP16 true PRoot runtime boundary: run 37892321937
- Desktop, both Android builds, emulator Node boot/restart and read-only HTTP API passed.
- Native PRoot exec gate: run-as stdin marker confirmed; UID u0_a150; .so PRoot binary and loader executable under /data/app, BusyBox file executable inside app-private rootfs.
- Native command returned nonzero with no stdout/stderr; no CP16_PROOT_EXEC_PASS. This is a genuine unresolved native execution boundary, not a CI path/quoting issue.
- Next diagnostic adds PRoot -v 9 verbose tracing and prints the native process exit status; keep gate fail-closed. Physical ARM64, interactive terminal and chat persistence still UNTESTED.

## CP16 native PRoot exit 139 (CI 37892838996)
- Desktop and Android ARM64/x86_64 compile PASS; Node restart and read-only HTTP PASS.
- Native PRoot executed from app UID with all binary paths present, but returned exit 139, usually SIGSEGV. Not yet proven why.
- ELF DT_NEEDED: libtalloc_v2.so and libandroid-shmem.so. Production PRootManager.runtimeEnvironment sets LD_LIBRARY_PATH to nativeLibraryDir, but test harness omitted it.
- Updated CI PRoot probe to export LD_LIBRARY_PATH to nativeLibraryDir, added contract assertion. Fresh emulator pass/fail still needed. Do not mark PRoot verified until guest command marker observed.

## CP16 PRoot dependency hypothesis disproved, CI 37893656722
- LD_LIBRARY_PATH matched production nativeLibraryDir but PRoot still exited 139.
- App UI, Node startup/restart, HTTP read-only guards and ARM64/x86_64 compile remain green.
- Added Android crash-buffer capture (`adb logcat -d -b crash`) on the PRoot failure path, to preserve available debuggerd/backtrace evidence without disclosing chat data.
- PRoot remains BLOCKED; do not mark native Linux or chat persistence verified.

## CP16 checkpoint: PRoot native isolation
- CI 37894231576 again returned PRoot exit 139. `runtime-proot-crash-logcat.txt` artifact is zero bytes, so no backtrace available.
- Added `--help` binary-only preflight in app UID before guest PRoot invocation to separate ELF init from runtime translation. Preserve non-mutating probes and fail-closed status.
- Report: checkpoints/CP16/PROOT_NATIVE_BLOCKER_37894231576.md.

## CP16 PRoot isolated help probe FAIL — run 37911832910
- On Android 36 x86_64 emulator, the fixed app-UID PRoot executable run with only `--help` returned 139 (`CP16_PROOT_HELP_EXIT=139`, `CP16_PROOT_ELF_INIT_SIGSEGV`).
- This proves the failure is reproducible **without** Alpine rootfs translation or guest shell. Investigate ELF initialization, toolchain/NDK provenance, dynamic dependencies and Android native linking/relocation on emulator.
- Desktop and Android ARM64/x86_64 build jobs PASS; emulator native command gate fails as designed.
- Do not claim cause is definitively the binary itself until native backtrace, symbolization or dependency isolation confirms it. Avoid replacing binaries without provenance/hash/license checks.
- Latest isolated diagnostic source commit `5600cb2`; draft PR #1, main untouched.

## CP16 isolated talloc linker repair (2026-10-10)
- CI 37914967175 selected the clean PRoot candidate but Android linker rejected a missing talloc_enable_leak_report symbol, exit 45.
- QA-only x86_64 PRoot was re-linked against a separate clean talloc candidate SONAME, retaining production runtime unchanged. Provenance and expected hashes in checkpoints/CP16/PROOT_CLEAN_CANDIDATE_20261009.md.
- Re-run contract tests and GitHub emulator CI. Require both PRoot --help and fixed read-only Alpine marker to pass. Physical ARM64 remains unverified and PR #1 must stay draft.

## CP16 x86_64 candidate native Linux PASS (2026-10-10)
- **CI 38004055930 all four jobs GREEN** on app source commit 048828ad8e6e77b201d259e004bc037a2f7012af.
- App cold start/restart Node HTTP and read-only API guards PASS. QA-only clean PRoot candidate --help exited 0, fixed Alpine BusyBox guest command emitted CP16_PROOT_EXEC_PASS and final CP16_PROOT_READONLY_SMOKE_PASS as the app UID.
- This is the first VERIFIED native x86_64 guest-command gate; production binary remains unchanged. Physical ARM64, actual terminal/PTY, real agents and chat persistence unverified.
- See checkpoints/CP16/PROOT_QA_PASS_38004055930.md and draft PR #1. No main/UI changes. Do not auto-promote QA sidecar or merge the PR.

## CP16 chat persistence gate, isolated continuation (2026-10-13)
- Latest baseline verified from GitHub: `6db00b1`, including production PRoot and four terminal lifecycle instrumentation tests. Do not return to the earlier PRoot candidate-only baseline.
- Worktree `/home/sprite/v2-chat-persistence-20261013` on `qa/cp16-chat-persistence-20261013`; existing uncommitted PTY/CMake changes in the original publication worktree were not modified or included.
- Shared fixture probe sends five synthetic messages with triggerTurn=false, checks exact payloads after restart, keeps private proof out of artifacts and cleans it on EXIT. Android mutation is CI/emulator-only.
- Real desktop process SIGKILL/restart x3 PASS. Negative controls reject lost/duplicated/moved/modified histories. Fresh emulator persistence evidence is PENDING.
- `npm test` now includes `qa:baseline`, ensuring the existing desktop CI job actually runs all contract/integration tests.
- Report: checkpoints/CP16/CHAT_PERSISTENCE_GATE_20261013.md. No production server/UI/native change; power-loss/partial-write durability, live agents, PTY and physical ARM64 remain unverified.

## First CI attempt: existing ELF-tool deadline
- CI 38398293447 desktop job executed all 17 new retry tests successfully, but the older native dependency test failed with `spawnSync nm ETIMEDOUT` at its 4000 ms deadline. The desktop result was **83/84**, not a green full pipeline.
- Increased only the native inspection subprocess deadline to 15000 ms. All pinned hashes, dependency, symbol and LOAD-alignment assertions remain mandatory. No binary changed, no failed test skipped, and this is not a claim of a 15-second runtime performance target.
- The full corrected revision needs a fresh CI result before being declared verified.

## First Android run: history versus telemetry assertion
- CI 38405598188: desktop 110/110 and both Android builds passed. Android reached the end of all 13 expected rejection checks, but the probe failed with `Rejected request changed history` before persistence/restart.
- The probe was incorrectly comparing the entire `/api/chats` response envelope. Source `getPublicStatus()` includes `wakelock.uptimeSec` and `heartbeatAt`, which can change even when every chat message is unchanged. The first-run log does not include payload snapshots, so it cannot identify the exact differing field.
- The corrected assertion compares every room and complete message object in `chats`, while excluding only sibling status telemetry. Four negative/positive controls prove that telemetry ticks are allowed but changed messages, added/deleted/moved rooms or malformed history still fail.
- No server request-policy checks were relaxed. A corrected full CI run is required before signoff.
