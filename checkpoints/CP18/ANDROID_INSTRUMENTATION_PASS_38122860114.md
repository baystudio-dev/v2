# CP18: Android application-level PRoot and terminal integration PASS

Date: 2026-10-11.
Evidence: https://github.com/bayurohmat608-create/v2/actions/runs/38122860114
Code under test: `3952a0f`; x86_64 emulator job: `114421394637`.

## Verified
- All 4 CI jobs PASS: desktop; Android 36 ARM64 APK build/lint; Android 36 x86_64 APK build/lint; Android 36 x86_64 emulator runtime.
- Existing embedded Node cold start/restart, read-only API guard, and CP17 **production** PRoot smoke remain green, including `CP17_PROOT_PRODUCTION_READONLY_SMOKE_PASS`.
- CP18 now compiles the app APK and its instrumentation APK **together** on the existing emulator runner so signing certificates match; no workflow file change required.
- The runner emitted `CP18_INSTRUMENTATION_BUILD_START`, `CP18_INSTRUMENTATION_BUILD_PASS`, and genuine AndroidJUnitRunner output:
  - `terminalSessionReceivesCommandAndCloses`: `INSTRUMENTATION_STATUS_CODE: 0`.
  - `productionLauncherExecutesAlpineGuestCommand`: `INSTRUMENTATION_STATUS_CODE: 0`.
  - `OK (2 tests)`; `CP18_PROOT_MANAGER_AND_TERMINAL_INSTRUMENTATION_PASS`.
- These tests execute production Kotlin classes `PRootManager` and `TerminalSession` under Android app identity. They exercise read-only fixed guest commands and close lifecycle, **not** an HTTP shell endpoint.
- Baseline local contract tests before push: 38/38 PASS.

## Scope and limitations
- This demonstrates app-level PRoot invocation and **pipe-backed** terminal command I/O on Android 36 x86_64 emulator.
- UI interactions (clicking terminal overlay, keyboard/IME), PTY programs, long-lived multi-command sessions, and resource stress have not been verified.
- Physical ARM64 PRoot runtime execution, 16 KiB physical runtime, installed Codex/OpenCode engines and live multi-agent operation remain unverified.
- AndroidTest APK is not shipped in the app's production APK. CI emulator is disposable and uses no user workspace, secrets or chat data.
- `main` remains unchanged, and PR #1 must stay draft pending remaining evidence.
