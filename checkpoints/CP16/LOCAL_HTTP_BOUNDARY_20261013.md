# CP16 / CP19 foundation: local HTTP request boundary

## Baseline and scope
- Parent PR #1 head: `8f52bb3a1fa1e3abdf18a3e456798f768cf7d6db`, following retry-receipt CI 38399249491.
- Isolated worktree: `/home/sprite/v2-http-boundary-20261013`, branch `qa/cp16-http-boundary-20261013`.
- Original PTY/CMake WIP was fingerprinted: 37 dirty/untracked files. None is edited or included. No change to main, web UI source, native binaries, Android Kotlin/C++, provider credentials or workflow permissions.
- This checkpoint hardens the browser-to-loopback boundary before wider client/API integration. It does NOT implement caller authentication, room ACLs, encryption or client retry UI.

## Reproduced issues in the pinned parent
Two tests ran against the real old `server.js` in disposable storage and failed as expected:
1. A request with matching hostile `Host: rebound.invalid:3000` and `Origin: http://rebound.invalid:3000` received HTTP 200 from `/api/chats`. The prior CORS allowlist trusted the unvalidated request Host.
2. An originless `text/plain` POST containing JSON was accepted by the inert internal chat endpoint and returned HTTP 200. The backend parsed browser-simple media types as JSON mutations.
The same tests now require 403 and 415 respectively and assert no changes to disk or message SSE. This is HTTP-level reproduction, not an end-to-end browser DNS-rebinding exploit demonstration. The isolated pre-fix log is `/home/sprite/v2-http-boundary-before-20261013.log`.

## Implemented policy
`agent/loopback-request-policy.js` is called before every route, including SSE, disabled auth endpoints and static assets.

- Listener configuration is restricted to literal `127.0.0.1`, `::1` or `localhost`. Wildcard/LAN/public binds are rejected; supported peer addresses are loopback IPv4, IPv6 and IPv4-mapped loopback.
- HTTP Host must be canonical `127.0.0.1`, `localhost` or `[::1]` with an optional valid port. DNS domains, userinfo, trailing dots, shorthand/hex IPs, malformed ports and duplicate security headers are rejected.
- Ports are deliberately not forced to the socket's port: existing ADB forwarding uses host port 33000 for device port 3000. This does not grant trust to another host.
- Any present Origin must equal the exact validated HTTP scheme/host/port. `localhost` and `127.0.0.1` are not interchangeable source origins. `null`, empty, multi-origin and path-bearing origins are denied.
- Any present Referer is also checked; a contradictory referrer cannot override or be hidden by Origin. Cross-site and same-site Fetch Metadata are denied for reads and writes. Unknown Sec-Fetch-Site values fail closed. API no-cors and embedding contexts are denied.
- Duplicate Host/Origin/Referer/Content-Type/Fetch Metadata/preflight headers are detected from Node rawHeaders rather than trusting a normalized field that can discard duplicates.
- Request targets must be origin-form paths, never absolute/proxy URLs or authority overrides. Forwarded headers do not grant trust.
- API POST requires application/json with optional UTF-8 charset. The exact legacy `application/json; utf-8` form is also accepted because existing Android QuickReplyReceiver and TerminalFeedbackManager use it. Other simple media types are denied before handlers. No native client was modified.
- Supported HTTP methods are GET, HEAD, POST and OPTIONS; event streaming requires GET. Validated same-origin preflight permits only the supported methods and Content-Type header, without wildcard origins, credentials, or private-network grants.
- Responses carry no-sniff, same-origin resource policy and anti-framing headers. API responses use no-store; SSE retains no-transform but now also no-store.
- Rejected requests get stable redacted errors and no Access-Control-Allow-Origin. No attacker URL, transcript, credential or request body is echoed or logged by the policy.

## Explicit compatibility exception and security limits
Native/CLI requests without Origin/Referer/Fetch Metadata remain accepted from loopback with validated Host and JSON media type. This is compatibility for Android health checks, terminal feedback and local tooling, NOT authentication. A local native process can forge headers. Same-origin XSS, malicious local apps, a trusted-origin compromised renderer, server-side request forgery, compromised OS, reverse proxies, full rate/body/resource limits and per-room authorization remain outside this gate. The legacy local client still has broad chat visibility.

External browser links/iframes and remote LAN/proxy hosting are not allowed by this strict local-workstation policy. Unknown or unusual embedded-browser provenance can now be rejected. No claim of universal CSRF protection or fully secure agent runtime is made.

## Verification before publication
- **111/111 local baseline tests PASS**, comprising all prior 84 tests and 27 new unit/live HTTP/CI-wiring tests.
- Real backend tests prove rejection before chat mutation or message SSE, retained exact keyed replay behavior, no provider process invocation, raw duplicate-header handling, strict source checks, preflight outcomes, ADB-forwarded port compatibility and byte-identical web asset serving.
- Shared `scripts/qa/loopback-http-probe.py` exercises **13 hostile contexts** over actual loopback HTTP. It checks stable refusal statuses, absence of CORS permission, unchanged full chat snapshots, plus native and same-origin positive controls. No transcripts are saved as artifacts.
- The probe runs only inside the existing explicit GitHub/emulator gate, before persistence fixtures. Existing five-message persistence and three-key replay probes now send same-origin browser-shaped headers, so accepted writes are verified as well.
- Android emulator verification **PASS in CI 38406779812**, with the measured markers below. The HTTP tests construct browser-shaped headers; actual browser automation of an attacker page, full WebView interactions and physical ARM64 remain untested.

## References used for design, not substitute runtime evidence
- OWASP CSRF prevention, Origin/Referer checks, Fetch Metadata and simple media types: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- Fetch Standard and browser-controlled request headers: https://fetch.spec.whatwg.org/
- Node HTTP rawHeaders and duplicate-header behavior: https://nodejs.org/api/http.html#messagerawheaders
The project-specific policy and measured results above are evidenced by the source/tests and subsequent CI log, not asserted by those external references.

## First Android run: history versus telemetry assertion
- CI 38405598188: desktop 110/110 and both Android builds passed. Android reached the end of all 13 expected rejection checks, but the probe failed with `Rejected request changed history` before persistence/restart.
- The probe was incorrectly comparing the entire `/api/chats` response envelope. Source `getPublicStatus()` includes `wakelock.uptimeSec` and `heartbeatAt`, which can change even when every chat message is unchanged. The first-run log does not include payload snapshots, so it cannot identify the exact differing field.
- The corrected assertion compares every room and complete message object in `chats`, while excluding only sibling status telemetry. Four negative/positive controls prove that telemetry ticks are allowed but changed messages, added/deleted/moved rooms or malformed history still fail.
- No server request-policy checks were relaxed. A corrected full CI run is required before signoff.

## Verified CI result
- **Run 38406779812: all four jobs PASS.** https://github.com/bayurohmat608-create/v2/actions/runs/38406779812
- Tested application/test source: `e993c4a0e0d7d0bd0e6aee07433636f122b4ebc9`.
- Desktop job ran the full npm smoke (engine version/health checks, not live model prompts) plus **111/111 baseline tests**. All prior 84 tests remain green.
- Android API 36 x86_64 log: `CP16_LOCAL_HTTP_BOUNDARY_PASS rejected=13 same_origin=1 native=1`. Thirteen hostile HTTP contexts were rejected by the installed backend, allowed native/same-origin reads remained healthy, and history stayed unchanged.
- Same-origin browser-shaped message headers also passed the existing real app restart gates: `CP16_MESSAGE_RETRY_REPLAY_PASS count=3`, `CP16_CHAT_PERSISTENCE_PASS count=5` and `CP16_ANDROID_CHAT_PERSISTENCE_PASS`.
- Production PRoot remained green: `CP17_PROOT_PRODUCTION_READONLY_SMOKE_PASS`.
- Existing PRoot/terminal instrumentation remained green: `OK (4 tests)` and `CP18_PROOT_MANAGER_AND_TERMINAL_INSTRUMENTATION_PASS`.
- Android ARM64 and x86_64 build/lint/ZIP-alignment jobs passed. Physical ARM64 runtime was **not** tested.
- Source of all runtime markers: `/home/sprite/v2-http-boundary-evidence-38406779812/ci.log`; summary JSON and run metadata are retained beside it. No new transcript artifact was uploaded.
- All 37 protected PTY/CMake files and their original worktree Git status were rechecked byte-for-byte unchanged.

## Remaining trust boundary
This is not authenticated local IPC. A malicious native process on the same machine can forge browser headers or use the originless compatibility path. An authenticated owner/capability handoff and room authorization are still needed; the exact 2048 receipt cap, UI retry integration, PTY/IME and live agents are unchanged. No universal exploit-resistance or release-readiness claim is made.
