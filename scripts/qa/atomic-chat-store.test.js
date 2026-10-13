"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { AtomicChatStore, ChatStorageError } = require("../../agent/atomic-chat-store");
const modulePath = require.resolve("../../agent/atomic-chat-store");
const OLD = { topic: "old", chats: { group: [{ id: "old", text: "PRIVATE_OLD_FIXTURE" }], direct_budi: [], direct_rian: [] }, contextMemory: { group: "keep" }, statuses: [], calls: [] };
const NEW = { ...OLD, topic: "new", chats: { ...OLD.chats, group: [...OLD.chats.group, { id: "new", text: "日本語 café 👩🏽‍💻\nline two" }] } };
const oldJSON = JSON.stringify(OLD);
const newJSON = JSON.stringify(NEW);
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-chat-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "chat_data.json");
  fs.writeFileSync(file, oldJSON);
  return { root, file };
}
function fault(code = "EIO") { return Object.assign(new Error("PRIVATE_ERROR_PATH_OR_PAYLOAD /secret/user.json"), { code }); }
function assertPrivateFailure(error, committed = false) {
  assert.ok(error instanceof ChatStorageError);
  assert.equal(error.committed, committed);
  assert.doesNotMatch(JSON.stringify(error.toPublic()), /PRIVATE|\/secret/);
  return true;
}

test("CP16 atomic writer preserves old bytes until replacement, flushes file and directory, and uses 0600", t => {
  const { root, file } = setup(t);
  const stages = [];
  const io = { ...fs,
    writeSync(fd, ...args) {
      assert.equal(fs.readFileSync(file, "utf8"), oldJSON);
      stages.push("write"); return fs.writeSync(fd, ...args);
    },
    fsyncSync(fd) { stages.push(fs.fstatSync(fd).isDirectory() ? "directory-sync" : "file-sync"); fs.fsyncSync(fd); },
    renameSync(from, to) {
      assert.equal(path.dirname(from), root);
      assert.equal(fs.statSync(from).mode & 0o777, 0o600);
      assert.equal(fs.readFileSync(file, "utf8"), oldJSON);
      stages.push("rename"); fs.renameSync(from, to);
    }
  };
  const result = new AtomicChatStore(file, { io }).writeSerialized(newJSON);
  assert.deepEqual(result, { committed: true, directorySynced: true });
  assert.deepEqual(stages, ["write", "file-sync", "rename", "directory-sync"]);
  assert.deepEqual(new AtomicChatStore(file).read(), NEW);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(root), ["chat_data.json"]);
});

for (const stage of ["directory-open", "temporary-open", "partial-write", "zero-write", "file-sync", "file-close", "rename"]) {
  test(`CP16 atomic ${stage} failure preserves exact previous file and cleans owned temporary`, t => {
    const { root, file } = setup(t);
    const io = { ...fs };
    if (stage === "directory-open" || stage === "temporary-open") {
      io.openSync = (name, ...args) => {
        if ((stage === "directory-open" && name === root) || (stage === "temporary-open" && name.includes(".atomic-"))) throw fault("ENOSPC");
        return fs.openSync(name, ...args);
      };
    }
    if (stage === "partial-write") io.writeSync = (fd, buffer, offset, length, position) => {
      fs.writeSync(fd, buffer, offset, Math.min(7, length), position);
      throw fault("ENOSPC");
    };
    if (stage === "zero-write") io.writeSync = () => 0;
    if (stage === "file-sync") io.fsyncSync = fd => { if (!fs.fstatSync(fd).isDirectory()) throw fault(); return fs.fsyncSync(fd); };
    if (stage === "file-close") io.closeSync = fd => {
      const regular = fs.fstatSync(fd).isFile(); fs.closeSync(fd); if (regular) throw fault();
    };
    if (stage === "rename") io.renameSync = () => { throw fault("EACCES"); };
    assert.throws(() => new AtomicChatStore(file, { io }).writeSerialized(newJSON), e => assertPrivateFailure(e));
    assert.equal(fs.readFileSync(file, "utf8"), oldJSON);
    assert.deepEqual(fs.readdirSync(root), ["chat_data.json"]);
  });
}

test("CP16 atomic writer handles short writes without truncating UTF-8", t => {
  const { file } = setup(t);
  let calls = 0;
  const io = { ...fs, writeSync(fd, bytes, offset, length, position) {
    calls++; return fs.writeSync(fd, bytes, offset, Math.min(3, length), position);
  } };
  new AtomicChatStore(file, { io }).writeSerialized(newJSON);
  assert.ok(calls > 3);
  assert.equal(fs.readFileSync(file, "utf8"), newJSON);
});

test("CP16 post-rename directory fsync failure reports committed-but-uncertain, never false rollback", t => {
  const { root, file } = setup(t);
  const io = { ...fs, fsyncSync(fd) { if (fs.fstatSync(fd).isDirectory()) throw fault("EIO"); fs.fsyncSync(fd); } };
  assert.throws(() => new AtomicChatStore(file, { io }).writeSerialized(newJSON), error => {
    assertPrivateFailure(error, true);
    assert.equal(error.code, "CHAT_STORAGE_COMMIT_UNCERTAIN");
    assert.equal(error.retryable, false);
    assert.equal(error.requiresReconciliation, true);
    return true;
  });
  assert.equal(fs.readFileSync(file, "utf8"), newJSON);
  assert.deepEqual(fs.readdirSync(root), ["chat_data.json"]);
});

test("CP16 unreadable/corrupt/non-object chat files fail closed and are not overwritten on read", t => {
  const { file } = setup(t);
  for (const raw of ["{partial", "null", "[]", '{"chats":[]}', '{"chats":{"group":{}}}', '{"contextMemory":{"group":[]}}']) {
    fs.writeFileSync(file, raw);
    assert.throws(() => new AtomicChatStore(file).read(), e => e.code === "CHAT_STORAGE_UNREADABLE" && assertPrivateFailure(e));
    assert.equal(fs.readFileSync(file, "utf8"), raw);
  }
});

test("CP16 unsafe linked targets are rejected without changing the linked document", t => {
  const { root, file } = setup(t);
  const protectedFile = path.join(root, "protected.json");
  fs.renameSync(file, protectedFile);
  for (const kind of ["symlink", "hardlink"]) {
    if (kind === "symlink") fs.symlinkSync(protectedFile, file); else fs.linkSync(protectedFile, file);
    const store = new AtomicChatStore(file);
    assert.throws(() => store.read(), e => e.code === "CHAT_STORAGE_UNREADABLE");
    assert.throws(() => store.writeSerialized(newJSON), e => !e.committed);
    assert.equal(fs.readFileSync(protectedFile, "utf8"), oldJSON);
    fs.unlinkSync(file);
  }
});

test("CP16 absent canonical file ignores orphaned temporary, invalid new JSON never touches disk", t => {
  const { root, file } = setup(t);
  fs.unlinkSync(file);
  fs.writeFileSync(path.join(root, ".chat_data.json.atomic-orphan.tmp"), newJSON);
  assert.equal(new AtomicChatStore(file).read(), null);
  assert.throws(() => new AtomicChatStore(file).writeSerialized("not json"), e => !e.committed);
  assert.equal(fs.existsSync(file), false);
});

for (const phase of ["partial-write", "file-flushed", "before-rename", "after-rename"]) {
  test(`CP16 real SIGKILL at ${phase} leaves canonical snapshot complete and recoverable`, { timeout: 10000 }, async t => {
    const { root, file } = setup(t);
    const source = `const fs=require('node:fs');
const {AtomicChatStore}=require(${JSON.stringify(modulePath)});
const file=${JSON.stringify(file)}, phase=${JSON.stringify(phase)};
const sleep=()=>{fs.writeSync(1,'AT_BOUNDARY\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
const io={...fs};
io.writeSync=(fd,b,o,l,p)=>{if(phase==='partial-write'){fs.writeSync(fd,b,o,Math.min(7,l),p);sleep();}return fs.writeSync(fd,b,o,l,p);};
io.fsyncSync=fd=>{fs.fsyncSync(fd);if(phase==='file-flushed'&&!fs.fstatSync(fd).isDirectory())sleep();};
io.renameSync=(a,b)=>{if(phase==='before-rename')sleep();fs.renameSync(a,b);if(phase==='after-rename')sleep();};
new AtomicChatStore(file,{io}).writeSerialized(${JSON.stringify(newJSON)});`;
    const child = spawn(process.execPath, ["-e", source], { stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH } });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
    let stderr = ""; child.stderr.on("data", b => { stderr += b; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Writer did not reach controlled boundary")), 4000);
      child.stdout.once("data", b => { clearTimeout(timer); if (String(b).includes("AT_BOUNDARY")) resolve(); else reject(new Error("Unexpected writer marker")); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Writer exited before kill: " + stderr)); });
      child.once("error", reject);
    });
    const exited = once(child, "exit"); child.kill("SIGKILL");
    const [, signal] = await exited; assert.equal(signal, "SIGKILL");
    const expected = phase === "after-rename" ? newJSON : oldJSON;
    assert.equal(fs.readFileSync(file, "utf8"), expected);
    assert.deepEqual(new AtomicChatStore(file).read(), JSON.parse(expected));
    // Temporary files are ignored on restart, never promoted into canonical history.
    assert.ok(fs.readdirSync(root).includes("chat_data.json"));
  });
}
