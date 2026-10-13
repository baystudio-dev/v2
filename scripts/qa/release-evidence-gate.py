#!/usr/bin/env python3
"""Fail-closed release evidence audit; no publish side effects."""
from pathlib import Path
import hashlib,json,sys,zipfile,subprocess
root=Path(__file__).resolve().parents[2]
apk=Path(sys.argv[1]) if len(sys.argv)>1 else root/'android/app/build/outputs/apk/debug/app-debug.apk'
required=['LICENSE','NOTICE','THIRD_PARTY_RUNTIME.md','third_party/THIRD_PARTY_NOTICES.md',
'third_party/licenses/PRoot-GPL-2.0.txt','third_party/licenses/talloc-LGPL-3.0-or-later.txt',
'third_party/licenses/libandroid-shmem-BSD-3-Clause.txt']
findings=[]
def check(name,passed,details=''):
 findings.append({'check':name,'pass':bool(passed),'details':details})
for name in required:check('repository:'+name,(root/name).is_file())
check('APK exists',apk.is_file(),str(apk))
if apk.is_file():
 with zipfile.ZipFile(apk) as z:
  entries=set(z.namelist())
  for name in required[3:]:
   check('APK asset:'+name,'assets/licenses/'+name in entries)
  libs=[x for x in entries if x.startswith('lib/') and x.endswith('.so')]
  check('Native libraries included',bool(libs),str(len(libs)))
  check('APK SHA-256 calculated',True,hashlib.sha256(apk.read_bytes()).hexdigest())
else:libs=[]
# No false legal clearance: these require human-verifiable artifact-specific evidence.
check('GPL corresponding source build scripts and patches',False,'Not independently matched to every distributed native ELF')
check('LGPL relinkability/replacement demonstration',False,'Not demonstrated for bundled talloc')
check('Node.js Mobile transitive notices',False,'Full binary-matched inventory not verified')
check('Alpine rootfs per-package licenses',False,'Complete rootfs package license inventory not verified')
check('All native ELF LOAD segments 16KiB',False,'Needs every extracted library checked and 16KiB runtime validation')
check('Physical ARM64 acceptance',False,'Not performed')
check('Release signing/provenance',False,'Only debug-signing evidence available')
report={'releaseReady':all(x['pass'] for x in findings),'apk':str(apk),'findings':findings}
print(json.dumps(report,indent=2))
raise SystemExit(0 if report['releaseReady'] else 2)
