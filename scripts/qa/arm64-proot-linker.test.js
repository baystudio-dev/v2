"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const root=resolve(__dirname, "../..");
const arm=join(root,"android/app/src/main/jniLibs/arm64-v8a");
const sha=file=>createHash("sha256").update(readFileSync(file)).digest("hex");
const run=(bin,args)=>{
  const r=spawnSync(bin,args,{encoding:"utf8",timeout:15000});
  assert.equal(r.status,0,r.stderr||r.error?.message);
  return r.stdout;
};
const expected={
  "libproot_exec.so":"8920d803c63691626131b0cd3a91b0c7da3ca071747c8d41dea0598c78f7b205",
  "libproot_loader.so":"722b12da915658aed15b885c85502deb0864398780816b912ae586e15f97706b",
  "libtalloc_candidate.so":"c96ed81fcab0d9a2e1eea1bf2c4c79bec27501d307dbfe6b24f608ea3c8baa1e"
};
function elf(name){return join(arm,name);}
test("ARM64 native PRoot links only its matching talloc candidate",()=>{
  const proot=elf("libproot_exec.so"), talloc=elf("libtalloc_candidate.so");
  for(const [name,digest] of Object.entries(expected)) assert.equal(sha(elf(name)),digest,name);
  const deps=run("readelf",["-d",proot]);
  assert.match(deps,/Shared library: \[libtalloc_candidate\.so\]/);
  assert.match(deps,/Shared library: \[libandroid-shmem\.so\]/);
  assert.doesNotMatch(deps,/Shared library: \[libtalloc_v2\.so\]/);
  assert.match(run("readelf",["-d",talloc]),/Library soname: \[libtalloc_candidate\.so\]/);
  const exports=run("nm",["-D",talloc]);
  assert.match(exports,/\bT talloc_enable_leak_report\b/);
  assert.match(exports,/\bT talloc_set_log_stderr\b/);
  assert.doesNotMatch(exports,/\bU rep_/);
  const undefinedNative=run("nm",["-D",proot]).split("\n")
    .filter(s=>/\bU (?:_?talloc[_a-zA-Z0-9]*)$/.test(s))
    .map(s=>s.trim().split(/\s+/).at(-1));
  const exported=new Set(exports.split("\n")
    .filter(s=>/\b[TWD] (?:_?talloc[_a-zA-Z0-9]*)$/.test(s))
    .map(s=>s.trim().split(/\s+/).at(-1)));
  assert.ok(undefinedNative.includes("talloc_enable_leak_report"));
  for(const symbol of undefinedNative) assert.ok(exported.has(symbol),symbol+" must resolve to bundled library");
});
test("ARM64 matched PRoot, talloc and guest loader have 16K ELF segments",()=>{
  for(const name of Object.keys(expected)){
    const binary=elf(name);
    assert.match(run("file",[binary]),/ELF 64-bit LSB.*ARM aarch64/);
    const program=run("readelf",["-Wl",binary]);
    const loads=program.split("\n").filter(s=>/^\s*LOAD\s/.test(s));
    assert.ok(loads.length>=2,name);
    for(const line of loads){
      const align=Number.parseInt(line.trim().split(/\s+/).at(-1),16);
      assert.ok(align>=16384,name+" has insufficient segment alignment "+line);
    }
  }
  const prootManager=readFileSync(join(root,"android/app/src/main/java/com/bossbayu/aiteam/runtime/PRootManager.kt"),"utf8");
  assert.match(prootManager,/"LD_LIBRARY_PATH" to nativeLibraryDir\.absolutePath/);
  const script=readFileSync(join(root,"scripts/native/build-arm64-proot.sh"),"utf8");
  for(const sha of [
    "75f654fe60dea92dabff2bf083ae8bfe4f91baa6a1a374786a6bf391015eebaa",
    "912afa237510ae542a7733998eb18a12bcda35ab6729c8e2ddb43e8d0ebab007",
    "1e5ff8459bc0a8c229dd8a94b27d119987e09ef3414331c2b5ebfff20b98e867"
  ]) assert.ok(script.includes(sha));
  assert.match(script,/libtalloc_candidate\.so/);
  assert.match(script,/max-page-size=16384/);
});
