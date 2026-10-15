#!/usr/bin/env python3
"""Audit actual APK payload, not just native source artifacts (no runtime execution)."""
import hashlib
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile

if len(sys.argv) != 2:
    raise SystemExit("usage: verify-arm64-apk-native.py path/to/debug.apk")
apk = Path(sys.argv[1])
if not apk.is_file():
    raise SystemExit("APK missing: "+str(apk))
wanted = ("libproot_exec.so", "libproot_loader.so", "libtalloc_candidate.so")
prefix = "lib/arm64-v8a/"

with ZipFile(apk) as archive, tempfile.TemporaryDirectory(prefix="wa-apk-native-") as tmp:
    names = set(archive.namelist())
    for name in wanted:
        if prefix+name not in names:
            raise SystemExit("Missing JNI artifact: "+name)
    paths = {}
    for name in wanted:
        output = Path(tmp)/name
        output.write_bytes(archive.read(prefix+name))
        paths[name] = output

    def readelf(*args):
        r = subprocess.run(["readelf",*args],capture_output=True,text=True,timeout=15,check=True)
        return r.stdout

    deps = readelf("-d",str(paths["libproot_exec.so"]))
    assert "Shared library: [libtalloc_candidate.so]" in deps
    assert "Shared library: [libandroid-shmem.so]" in deps
    assert "Shared library: [libtalloc_v2.so]" not in deps
    assert "Library soname: [libtalloc_candidate.so]" in readelf("-d",str(paths["libtalloc_candidate.so"]))
    syms=readelf("-Ws",str(paths["libtalloc_candidate.so"]))
    for symbol in ("talloc_enable_leak_report","talloc_set_log_stderr"):
        found=any(re.search(r"\bGLOBAL\s+DEFAULT\s+\d+\s+"+symbol+r"$",line.strip()) for line in syms.splitlines())
        assert found, "missing dynamic export: "+symbol
    for name,p in paths.items():
        ph=readelf("-Wl",str(p))
        matches=[l for l in ph.splitlines() if re.match(r"^\s*LOAD\s+",l)]
        assert len(matches)>=2,name
        for line in matches:
            align=int(line.split()[-1],16)
            assert align>=16384,(name,line)
        print("PASS",name,"size",p.stat().st_size,"sha256",hashlib.sha256(p.read_bytes()).hexdigest())
    print("PASS ARM64_APK_MATCHED_NATIVE_PAIR_AND_16K_ELF")
