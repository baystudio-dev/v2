# V2 pre-release readiness audit

- Baseline: fe33d3192afbc78eecbe478fb7c90aad9264ba36, isolated release branch.
- Comment cleanup is conservative; legal notices and license texts are exempt.
- LICENSE (Apache-2.0), NOTICE and THIRD_PARTY_RUNTIME.md are present.
- RELEASE BLOCKER: Exact redistribution obligations for GPL-2.0 PRoot, LGPL-3.0-or-later talloc, BSD-3-Clause libandroid-shmem, Node.js Mobile, Alpine and other bundled dependencies are not yet fully evidenced by exact license texts, corresponding source/build recipes, and applicable source availability. Provenance hashes alone do not establish compliance.
- Existing APK debug CI 38408459519 passed, but this cleanup branch needs a fresh build.
- Physical ARM64 and end-to-end agent/PTY testing remain open.
- Do not publish a public GitHub Release or tag before licensing gate is cleared; prepare an internal candidate only.
