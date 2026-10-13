"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const repo = path.resolve(__dirname, "../..");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const seed = { topic: "Disk failure fixture", modelA: "codex/gpt-6.1-sol", modelB: "opencode/nemotron-3-ultra-free",
  chats: { group: [{ id: "old", text: "PRIVATE_ORIGINAL_HISTORY", chatId: "group" }], direct_budi: [], direct_rian: [], custom: [{ id: "keep" }] },
  statuses: [], calls: [], internalPeer: [], contextMemory: { group: "KEEP_CONTEXT", direct_budi: "", direct_rian: "" },
  futureMetadata: { preserve: true }
};

async function newBackend(t, raw = JSON.stringify(seed)) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-storage-http-"));
  const serverDir = path.join(root, "server");
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(serverDir); fs.mkdirSync(runtime);
  fs.copyFileSync(path.join(repo, "server.js"), path.join(serverDir, "server.js"));
  fs.cpSync(path.join(repo, "agent"), path.join(serverDir, "agent"), { recursive: true });
  const file = path.join(runtime, "chat_data.json"); fs.writeFileSync(file, raw);
  const trigger = path.join(root, "fault.json"); fs.writeFileSync(trigger, "{}");
  const providerAttempt = path.join(root, "provider-attempted");
  const preload = path.join(root, "fault-injection.cjs");
  fs.writeFileSync(preload, `// Only this disposable child process is instrumented. Production has no fault flags.
const fs=require('node:fs'), cp=require('node:child_process');
const read=fs.readFileSync, open=fs.openSync, write=fs.writeSync, sync=fs.fsyncSync, rename=fs.renameSync;
const handles=new Map();
const fault=()=>JSON.parse(read(${JSON.stringify(trigger)},'utf8')).stage;
const error=code=>Object.assign(new Error('PRIVATE_PAYLOAD /secret/path'),{code});
fs.openSync=function(name,...args){
 const isTmp=typeof name==='string'&&name.includes('.chat_data.json.atomic-');
 if(isTmp&&fault()==='open-full')throw error('ENOSPC');
 const fd=open.call(this,name,...args); if(isTmp)handles.set(fd,'temp');else if(name===${JSON.stringify(runtime)})handles.set(fd,'dir');else handles.delete(fd);return fd;
};
fs.writeSync=function(fd,b,o,l,p){
 if(handles.get(fd)==='temp'&&fault()==='partial-full'){write.call(this,fd,b,o,Math.min(5,l),p);throw error('ENOSPC');}
 return write.apply(this,arguments);
};
fs.fsyncSync=function(fd){
 if(handles.get(fd)==='temp'&&fault()==='file-sync')throw error('EIO');
 if(handles.get(fd)==='dir'&&fault()==='dir-sync')throw error('EIO');
 return sync.call(this,fd);
};
fs.renameSync=function(from,to){if(to===${JSON.stringify(file)}&&fault()==='rename-denied')throw error('EACCES');return rename.call(this,from,to);};
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync']){
 const original=cp[name];cp[name]=function(command,...args){if(/(?:codex|opencode|antigravity)/i.test(String(command))){
 fs.writeFileSync(${JSON.stringify(providerAttempt)},'unexpected provider process');throw new Error('Provider disabled by test');}return original.call(this,command,...args);};
}
`);
  const reservation = net.createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening"); const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child;
  let logs = "";
  const streams = [];
  async function stop() {
    for (const stream of streams.splice(0)) stream.destroy();
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
  }
  async function start() {
    child = spawn(process.execPath, ["--require", preload, path.join(serverDir, "server.js")], {
      cwd: serverDir, stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: root, HOST: "127.0.0.1", PORT: String(port),
        CHAT_AI_RUNTIME_DIR: runtime, BUDI_WORKSPACE: path.join(root, "budi"), RIAN_WORKSPACE: path.join(root, "rian"),
        WORKSTATIONS_DIR: path.join(root, "workstations"), NODE_ENV: "test", WAKELOCK_DISABLED: "1" }
    });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { logs = (logs + chunk).slice(-8000); });
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      try { const response = await fetch(base + "/api/status", { signal: AbortSignal.timeout(250) }); await response.arrayBuffer(); if (response.ok) return; } catch {}
      await sleep(40);
    }
    throw new Error("Disposable backend did not start");
  }
  t.after(async () => { await stop(); fs.rmSync(root, { recursive: true, force: true }); });
  await start();
  async function request(route, body) {
    const response = await fetch(base + route, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined,
      headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(3000) });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text), text };
  }
  async function observe() {
    const events = [];
    await new Promise((resolve, reject) => {
      const req = http.get(base + "/api/events", response => {
        streams.push(response);
        let pending = "";
        response.on("data", chunk => {
          pending += chunk;
          let index;
          while ((index = pending.indexOf("\n\n")) >= 0) {
            const block = pending.slice(0, index); pending = pending.slice(index + 2);
            const event = block.match(/^event: (.*)$/m)?.[1];
            if (event) events.push(event);
            if (event === "init") resolve();
          }
        });
        response.on("error", () => {});
      });
      streams.push(req); req.once("error", reject);
    });
    return events;
  }
  return { root, file, runtime, request, observe, stop, start,
    setFault: stage => fs.writeFileSync(trigger, JSON.stringify({ stage })),
    noProviders: () => assert.equal(fs.existsSync(providerAttempt), false),
    privateLogs: () => assert.doesNotMatch(logs, /PRIVATE_PAYLOAD|\/secret\/path/)
  };
}
const message = text => ({ chatId: "group", sender: "user", senderName: "Synthetic QA", text, triggerTurn: false });

for (const stage of ["open-full", "partial-full", "file-sync", "rename-denied"]) {
  test(`CP16 real HTTP ${stage} failure rolls back RAM, does not acknowledge/broadcast, and recovers on explicit retry`, { timeout: 12000 }, async t => {
    const server = await newBackend(t);
    const before = await server.request("/api/chats");
    const bytes = fs.readFileSync(server.file, "utf8");
    const events = await server.observe();
    server.setFault(stage);
    const response = await server.request("/api/internal/chat-message", message("PRIVATE_REJECTED_MESSAGE"));
    assert.equal(response.status, stage.endsWith("full") ? 507 : 503);
    assert.equal(response.body.code, "CHAT_STORAGE_WRITE_FAILED");
    assert.equal(response.body.success, false);
    assert.equal(response.body.committed, false);
    assert.doesNotMatch(response.text, /PRIVATE|\/secret/);
    assert.equal(fs.readFileSync(server.file, "utf8"), bytes);
    assert.deepEqual((await server.request("/api/chats")).body.chats, before.body.chats);
    // Other legacy mutation paths share the rollback and typed error boundary.
    for (const [route, body] of [["/api/message", { chatId: "group", text: "PRIVATE_PUBLIC_SEND" }],
      ["/api/config", { topic: "PRIVATE_REJECTED_TOPIC" }], ["/api/clear", { chatId: "group" }]]) {
      const failed = await server.request(route, body);
      assert.equal(failed.body.code, "CHAT_STORAGE_WRITE_FAILED", route);
      assert.equal(failed.body.success, false);
      assert.equal(fs.readFileSync(server.file, "utf8"), bytes);
      assert.deepEqual((await server.request("/api/chats")).body.chats, before.body.chats);
    }
    await sleep(50);
    assert.equal(events.includes("message"), false, "Uncommitted message must not reach SSE");
    assert.ok(events.includes("storage_error"), "Storage failure is explicit");
    assert.deepEqual(fs.readdirSync(server.runtime).filter(x => x.includes(".atomic-")), []);
    server.noProviders(); server.privateLogs();
    server.setFault(null);
    const accepted = await server.request("/api/internal/chat-message", message("RECOVERED_FIXTURE"));
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.success, true);
    const after = await server.request("/api/chats");
    assert.equal(after.body.chats.group.length, before.body.chats.group.length + 1);
    assert.equal(after.body.chats.group.at(-1).text, "RECOVERED_FIXTURE");
    assert.equal(after.body.status.chatStorage.state, "ready");
    const disk = JSON.parse(fs.readFileSync(server.file, "utf8"));
    assert.deepEqual(disk.contextMemory, seed.contextMemory);
    assert.deepEqual(disk.futureMetadata, seed.futureMetadata);
  });
}

test("CP16 real HTTP directory-sync failure retains committed data, reports uncertainty and blocks blind duplicate writes", { timeout: 12000 }, async t => {
  const server = await newBackend(t);
  server.setFault("dir-sync");
  const response = await server.request("/api/internal/chat-message", message("COMMITTED_BUT_UNCONFIRMED"));
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "CHAT_STORAGE_COMMIT_UNCERTAIN");
  assert.equal(response.body.committed, true);
  assert.equal(response.body.retryable, false);
  assert.equal(response.body.requiresReconciliation, true);
  const disk = fs.readFileSync(server.file, "utf8");
  const snapshot = await server.request("/api/chats");
  assert.equal(snapshot.body.chats.group.at(-1).text, "COMMITTED_BUT_UNCONFIRMED");
  assert.equal(snapshot.body.status.chatStorage.state, "durability-unconfirmed");
  server.setFault(null);
  for (let i = 0; i < 2; i++) {
    const rejected = await server.request("/api/internal/chat-message", message("DO_NOT_AUTO_DUPLICATE"));
    assert.equal(rejected.status, 503);
    assert.equal(rejected.body.code, "CHAT_STORAGE_RECONCILIATION_REQUIRED");
    assert.equal(rejected.body.committed, false);
    assert.equal(fs.readFileSync(server.file, "utf8"), disk);
    assert.deepEqual((await server.request("/api/chats")).body.chats, snapshot.body.chats);
  }
  await server.stop(); await server.start();
  const recovered = await server.request("/api/chats");
  assert.deepEqual(recovered.body.chats, snapshot.body.chats);
  assert.equal(recovered.body.chats.group.filter(m => m.text === "COMMITTED_BUT_UNCONFIRMED").length, 1);
  server.noProviders(); server.privateLogs();
});

for (const raw of ['{"chats":', '{"chats":{"group":null}}']) {
  test("CP16 corrupt startup history stays on disk and cannot be silently replaced by defaults", { timeout: 8000 }, async t => {
    const server = await newBackend(t, raw);
    const status = await server.request("/api/status");
    assert.equal(status.body.chatStorage.state, "unavailable");
    assert.equal(status.body.chatStorage.writable, false);
    assert.equal((await server.request("/api/chats")).status, 503);
    assert.equal((await server.request("/api/events")).status, 503);
    const result = await server.request("/api/internal/chat-message", message("REJECTED"));
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "CHAT_STORAGE_UNREADABLE");
    assert.equal(fs.readFileSync(server.file, "utf8"), raw);
    server.noProviders(); server.privateLogs();
  });
}
