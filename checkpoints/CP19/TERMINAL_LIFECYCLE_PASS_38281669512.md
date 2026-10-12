# CP19 Terminal lifecycle hardening: emulator verification PASS

Date: 2026-10-12
CI: https://github.com/bayurohmat608-create/v2/actions/runs/38281669512
Emulator job: 114920927403. Source commit: 99272fd.

## Verified
- All 4 CI jobs PASS: desktop, Android 36 ARM64 and x86_64 build, Android 36 x86_64 emulator.
- Instrumentation returned OK (4 tests). Each test recorded INSTRUMENTATION_STATUS_CODE: 0:
  - immediateCloseDoesNotResurrectSessionAndNewSessionWorks
  - terminalSessionReceivesCommandAndCloses
  - productionLauncherExecutesAlpineGuestCommand
  - multipleCommandsInOrderAndExitAreObserved
- Existing production PRoot smoke CP17_PROOT_PRODUCTION_READONLY_SMOKE_PASS.
- Local baseline 38/38 PASS; Android x86_64 instrumentation APK compiled before push.

## Changes
- TerminalSession now tracks explicit NEW/STARTING/RUNNING/FINISHED/CLOSED state.
- Process handoff is synchronized, start is idempotent, closed sessions cannot restart.
- Bounded command queue (32 messages, each at most 8192 chars), asynchronous writer.
- close() destroys child without blocking UI to close pipes; I/O cleanup stays on worker.
- Instrumentation verifies eight ordered commands, exit 0, immediate close, and reopening a new session.

## Not yet verified
- Pipe-backed only, not PTY. No UI keyboard/IME or long-duration stress.
- No real device ARM64 PRoot runtime proof or live agent execution.
- PR #1 remains draft; main unchanged.
