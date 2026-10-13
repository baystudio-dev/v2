# Corresponding-source and license evidence audit

This is a **pre-release gate**, not a legal clearance or publication approval.

## Verified source archive integrity

- **proot**: `proot-v5.1.107.96.zip`, SHA-256 `75f654fe60dea92dabff2bf083ae8bfe4f91baa6a1a374786a6bf391015eebaa` verified; archive legal-text candidates: `proot-5.1.107.96/COPYING`.
- **talloc**: `talloc-2.5.0.tar.gz`, SHA-256 `912afa237510ae542a7733998eb18a12bcda35ab6729c8e2ddb43e8d0ebab007` verified; archive legal-text candidates: `talloc-2.5.0/LICENSE`.
- **shmem**: `libandroid-shmem-v0.7.tar.gz`, SHA-256 `1e5ff8459bc0a8c229dd8a94b27d119987e09ef3414331c2b5ebfff20b98e867` verified; archive legal-text candidates: `libandroid-shmem-0.7/LICENSE`.

## Redistribution requirements and unresolved evidence

- **GPL-2.0 PRoot**: include full GPL text, complete *corresponding* modified source, build/install scripts, notices, and an equivalent-access download alongside APK. Upstream archive alone does not prove that locally rebuilt APK binaries are reproducible from that archive.
- **LGPL-3.0-or-later talloc**: provide LGPL and GPL text, minimal corresponding source and either a suitable replaceable shared-library mechanism or corresponding relinkable application code as applicable; test that users can substitute a compatible modified library.
- **BSD-3-Clause libandroid-shmem**: preserve copyright, conditions, and disclaimer in binary distribution notices.
- **Node.js Mobile / Node.js / bundled npm modules, Alpine rootfs packages, Android dependencies, highlight.js**: exact per-version bundled notices and sources/licenses require inventory of the built APK, not assumptions from manifest.
- **Provenance gap**: preserve local PRoot/talloc/shmem patches, compile/link commands and checksums in a public source package matching the actual distributed ELF. Rebuild proof and complete notices are not yet established.
- **Packaging gap**: verify license notices accessible to APK recipients (in-app or accompanying download), not only in repository root.
- **Distribution gate**: no GitHub public Release, APK upload or tag until the above evidence is complete and reviewed. This is a conservative compliance assessment, not legal advice.

## Official license guidance

- https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
- https://www.gnu.org/licenses/lgpl-3.0.html
- https://www.gnu.org/licenses/old-licenses/gpl-2.0-faq.en.html

