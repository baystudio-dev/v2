# WhatsApp Agent V2 — Interaction parity and Android safe-area checkpoint (2026-10-16)

## Research references

- WhatsApp Help Center: Android Enter key can be configured to send or insert a newline:
  https://faq.whatsapp.com/1159217535009237/?cms_platform=android
- WhatsApp Help Center: WhatsApp Web supports keyboard shortcuts (chat, search, Escape, new chat, emoji):
  https://faq.whatsapp.com/6204576529560565/?cms_platform=web
- WhatsApp Help Center: voice-note hold/release, swipe left to cancel, swipe up to lock:
  https://faq.whatsapp.com/657157755756612/?cms_platform=android
- Android Developers: targetSdk >=35 enforces edge-to-edge on Android 15+; reserve system bars/cutout, and handle keyboard IME:
  https://developer.android.com/develop/ui/views/layout/edge-to-edge

These are behavioral references. Do not use WhatsApp's proprietary assets or imply WhatsApp's security properties or official affiliation.

## Bugs reproduced and corrected in source

1. **Android system bars covered our WebView controls:** SDK 36 edge-to-edge was enabled but the root view lacked status/nav/cutout/IME insets. The native Activity and fullscreen terminal dialog now reserve actual OS insets, using a single owner of the safe area.
2. **Native floating Terminal button covered the chat Send/Mic touch region:** removed the redundant floating native FAB. Terminal access remains through existing WebView actions that open the native Android terminal.
3. **Conflicting CSS view heights:** last-loaded mobile sizing stylesheet uses the resized WebView height, flex min-height zero, and no duplicate system safe-area padding; sidebar, chat composer and terminal modal stay in bounds.
4. **Tiny landscape terminal modal pushed Close off screen:** header and action row can wrap; inputs shrink without truncating essential controls.
5. **Duplicate Terminal tab event, inert single engine vault tab, settings showing success on failed HTTP:** routed Terminal once, demoted the one-option tab to non-button text, added rejection feedback for failed settings and workstation requests.
6. **Draft disappeared on send failure:** sending now waits for HTTP success, prevents double tap while pending, preserves the text/quote on failures, and keeps independent in-memory drafts when switching between group/Budi/Rian.
7. **Wrong default Enter behavior on Android:** mobile defaults to newline, desktop to send; Settings offers Enter-to-send, persisted as a local non-sensitive boolean; Shift+Enter newline; Ctrl/Cmd+Enter sends; composition events are not intercepted.
8. **Bubble action discovery and Back:** long-press touch opens the existing action menu, with swipe/scroll cancelling long-press. Android Back hides IME first, then closes sheets/popups, then returns to chat list, then backgrounds the app. ESC mirrors layered Back.
9. **Keyboard access:** chat list, status updates and user profile respond to Enter/Space; native buttons retain focus and tap targets.

## Interaction matrix

| Gesture/interaction | Implemented | Validation |
| --- | --- | --- |
| Tap chat/group tab | Existing and exercised | Browser fixture |
| Compose multiline + Send/Mic morph | Yes | Browser fixture |
| Android Enter/newline preference, desktop send | Yes | Browser fixture (mobile) |
| Shift+Enter newline; Ctrl+Enter send; IME composing guard | Yes | Browser fixture + source contracts |
| Single tap send, HTTP failure keeps draft, HTTP success clears | Yes | Browser fixture with 503 then 200 |
| Preserve per-chat unsent drafts while switching rooms | Yes, memory only | Browser fixture |
| Tap emoji, attachment, menu, terminal, Settings, modal close | Yes | Five browser viewports |
| Swipe right on message for quoted reply | Preexisting | Source contract, hardware untested |
| Touch long-press for context menu | Added | Browser synthetic pointer event |
| Back/Escape layered dismissal, IME hides first | Added | Source contract; Android device pending |
| User/system keyboard avoids top/nav collision | Native and CSS fixed | Kotlin compile pending; physical device pending |
| Voice note tap-hold, cancel-left, lock-up, actual audio upload | **Not implemented** | DO NOT claim parity. Existing simulated voice note needs replacement and proof. |
| E2EE messaging and selective room authentication | **Not verified** | Do not make security claims. |

## QA / evidence

- Parent baseline: `78682e150c26280b9d71cf3ceeaadf77bcc3baef` (ARM64 matched PRoot linker build retained).
- Isolated worktree: `/home/sprite/v2-mobile-insets-qa-20261016`
- Branch: `fix/mobile-insets-and-interactions-20261016`
- Source regression: `npm run qa:baseline` 142/142 PASS.
- Browser interaction harness: `PLAYWRIGHT_MODULE=/home/sprite/.npm/_npx/e41f203b7505f1fb/node_modules/playwright node scripts/qa/mobile-touch-browser.cjs`: PASS 320x685, 360x740, 390x796, 412x860, 844x390; 0 reported page errors. Browser harness mocks API and bridge; does not execute agents or shell and does not demonstrate native Android insets.
- `git diff --check` PASS.
- **ARM64 local Gradle** lintDebug assembleDebug BUILD SUCCESSFUL in 3m 5s, 57 tasks; four nonfatal pre-existing WorkstationManager warnings.
- **APK SHA-256**: `131bd78c068922cc648c8c7805d64f092c8c4850b8626deb5ef4b7fde6024a66`, size 36,555,926 bytes. Packaged ELF pairs and symbols passed scripts/qa/verify-arm64-apk-native.py.
- **Signing**: apksigner verify PASS; certificate SHA-256 `33a87697bebf81d10a7f7e63db377ced54aa42ad58bbffae57b57f141e7121e6`, identical to previous debug APK. Update should not require uninstall.
- **Still unverified**: physical Android inset dispatch, Gboard, touch hit targets, 3-button navigation, network delivery under real provider, true media recording.

## Next acceptance criteria (fail-closed)

1. Gradle SDK36 ARM64 lintDebug/assembleDebug must pass with the new Kotlin insets/back implementation; verify APK contains the native PRoot repair. Identical signing cert is required before installing as an update.
2. Run Android physical ARM64: status bar/cutout, gesture-navigation and 3-button nav, IME open/close, multiline drafts, landscape rotation, modal close, Back, resume/reopen, native terminal, safe-area on different resolutions.
3. Verify Budi/Rian model execution *separately* after the ARM64 PRoot linker fix. Browser tests do not verify provider engines.
4. Implement actual audio recording and permission lifecycle before claiming WhatsApp-compatible voice-note gestures; remove simulated semantics in a separate approved checkpoint.
5. Audit popup focus trap and mobile screen reader; full WhatsApp parity is not yet established.
6. Keep public claims accurate: legacy UI encryption banner is NOT technical evidence of end-to-end encryption.

## Source preservation

Keep all feature branches and prior APKs intact, preserve source licensing/attribution, no automatic merge to main, no destructive app uninstall, no credential or chat export. If session pauses, the isolated worktree contains all WIP.
