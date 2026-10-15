# CP16 ARM64 PRoot native linker repair • 2026-10-16

## Reproduced failure and scope

Mas Bay's real Android screenshot showed `CANNOT LINK EXECUTABLE ... lib/arm64/libproot_exec.so`: missing `talloc_enable_leak_report`. Both Codex and OpenCode attempts failed before provider execution. The initial packaged `libproot_exec.so` depended on `libtalloc_v2.so` (old PRoot SHA-256 `0215493b9b088722cfdcfc6fa428ecd6bd7996fa85670f2dff9fd06acd287297`). APK's bundled `libtalloc_v2.so` did export that symbol when inspected offline. Thus the exact Android resolution cause is **not conclusively isolated**; a clean, uniquely linked native dependency pair is the supported repair hypothesis, not a proven runtime resolution.

## Minimal isolated fix

- New branch `fix/android-arm64-proot-linker-20261016`, parent `2d6554d81485c8629aaa02953cac2d3abdc78294`. Original worktree, `main`, PR #1 and x86_64 binaries remain unchanged.
- `scripts/native/build-arm64-proot.sh` builds **both** PRoot and talloc from pinned upstream sources, verifies all three source archive SHA-256 values, and incorporates two C header includes plus a minimal LGPL source replacement shim.
- PRoot now depends on `libtalloc_candidate.so` with matching SONAME and actual `talloc_enable_leak_report` export. New static guest loader is built from the same source.
- Rebuild uses Android NDK 27.0.12077973, `aarch64-linux-android26-clang`. PRoot, loader and candidate ELF LOAD segments align to 16 KiB.
- No UI, provider/model, user chats, terminal HTTP gate, credentials or runtime reinstallation flow changed.

## Verified evidence

- `npm run qa:baseline`: **133/133 PASS**, including dedicated ARM64 symbol, talloc dependency, source hashes and ELF alignment checks. Historical x86_64 test still checks byte-identical production/candidate binaries.
- `bash scripts/qa/build-android-debug.sh`: ARM64 `lintDebug assembleDebug` **BUILD SUCCESSFUL in 3m 1s**, 57 Gradle tasks. Four nonfatal preexisting Kotlin WorkstationManager cast warnings.
- `python3 scripts/qa/verify-arm64-apk-native.py <APK>`: **PASS** for actual APK payload, required symbols and 16 KiB segment alignment.
- APK SHA-256: `7dbe51e935932d930a1b8b5881ab40c596bc5b502f34540d8ee4c025a69a2878`.
- Old APK SHA-256: `7856416f92057f27957cff8461435c8adeeabae084cc89d0364fe71adea9cbc2`.
- Both APKs are debug signed with **identical** certificate SHA-256 `33a87697bebf81d10a7f7e63db377ced54aa42ad58bbffae57b57f141e7121e6`. Same applicationId/versionCode; replacement install *should* preserve app data, but actual device install is still unverified.
- Source ELF SHA-256 (before Gradle strip): PRoot `8920d803c63691626131b0cd3a91b0c7da3ca071747c8d41dea0598c78f7b205`; loader `722b12da915658aed15b885c85502deb0864398780816b912ae586e15f97706b`; talloc candidate `c96ed81fcab0d9a2e1eea1bf2c4c79bec27501d307dbfe6b24f608ea3c8baa1e`.

## Still pending

- **Physical ARM64** native `libproot_exec.so --help`, real Alpine shell/PRoot smoke, Budi/Rian agent invocation, existing chat migration, long running stability.
- No emulator runtime verification of ARM64: prior Android 36 x86_64 smoke proves only x86_64.
- This is a debug test candidate, not a release-readiness or verified model/provider claim. Preserve any existing app data; do **not** uninstall solely to test this fix.
- E2EE text in existing UI is still not substantiated; do not use this build for sensitive communications. Legal notice/source obligations in `third_party/THIRD_PARTY_NOTICES.md` remain open.
- Rollback: baseline commit `2d6554d` and the prior test APK. Do not force-push or merge without hardware evidence.
