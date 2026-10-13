# Third-party notices for WhatsApp AI Team v2

This file accompanies the Android application and does not relicense third-party code under the application's Apache-2.0 license.

| Component | Version | License / evidence | Distribution |
|---|---|---|---|
| PRoot | 5.1.107.96 | GPL-2.0; see `licenses/PRoot-GPL-2.0.txt` | Bundled native executable and loader |
| talloc | 2.5.0 | LGPL-3.0-or-later; see `licenses/talloc-LGPL-3.0-or-later.txt` | Bundled private shared library |
| libandroid-shmem | 0.7 | BSD-3-Clause; see `licenses/libandroid-shmem-BSD-3-Clause.txt` | Bundled native shared library |
| highlight.js | 11.9.0 | BSD-3-Clause, vendor header | Bundled web assets |
| nodejs-mobile | 24.20.0-0 | See upstream release and its transitive notices | Bundled native runtime |
| Alpine Linux | 3.24.2 | Per-package licenses; see distribution package metadata | Bundled minirootfs |
| Apache Commons Compress | 1.28.0 | Apache-2.0 | Gradle runtime dependency |

**Compliance not yet certified:** corresponding source and exact binary-to-source rebuild evidence for modified PRoot/talloc, Node.js Mobile's bundled third-party license inventory, Alpine per-package notices and the full Android dependency graph remain to be completed. These texts do not by themselves clear public redistribution.

Project provenance and pinned source checksums: `THIRD_PARTY_RUNTIME.md`.
