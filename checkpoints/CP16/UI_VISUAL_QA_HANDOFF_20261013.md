# Browser and Android visual QA handoff

- Baseline: design branch commit c32798c.
- Headless Chromium downloaded into isolated Sprite cache. Browser launch **blocked** by missing system shared library `libglib-2.0.so.0`. No screenshot was produced, so no visual pass is claimed.
- Android SDK in this Sprite contains build tools and platform tools, but no installed emulator executable. GitHub workflow still runs its existing Android emulator tests, but does not automatically upload screenshot evidence because the connected GitHub OAuth lacks workflow-write scope.
- Added a reproducible local static preview capture script for 390×844 portrait, 844×390 landscape and 1280×800 desktop. It fails closed if browser dependencies are absent.
- Static HTML previews do not prove Android WebView rendering, chat runtime, keyboard, scroll performance or accessibility.
- Next step: install browser system dependencies in a permitted environment or run the opt-in `CP16_UI_CAPTURE=1` script on a CI emulator and review its screenshot, without uploading private chat history.
