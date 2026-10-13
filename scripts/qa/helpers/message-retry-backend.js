"use strict";
// Test-only disposable backend. Never import this helper from application code.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const assert = require("node:assert/strict");
const repo = path.resolve(__dirname, "../../..");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const INITIAL = { chats: { group: [], direct_budi: [], direct_rian: [], custom: [{ id: "keep", text: "unrelated" }] },
  contextMemory: { group: "keep context", direct_budi: "", direct_rian: "" }, statuses: [], calls: [], internalPeer: [] };

async function retryBackend(t, initial = INITIAL) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "v2-retry-http-"));
  const server = path.join(root, "server"); const runtime = path.join(root, "runtime");
  fs.mkdirSync(server); fs.mkdirSync(runtime);
  fs.copyFileSync(path.join(repo, "server.js"), path.join(server, "server.js"));
  fs.cpSync(path.join(repo, "agent"), path.join(server, "agent"), { recursive: true });
  const file = path.join(runtime, "chat_data.json"); fs.writeFileSync(file, JSON.stringify(initial));
  const fault = path.join(root, "fault.json"); fs.writeFileSync(fault, "{}");
  const writes = path.join(root, "renames"); const provider = path.join(root, "provider-attempted");
  const preload = path.join(root, "test-faults.cjs");
  fs.writeFileSync(preload, `
const fs=require('node:fs'), cp=require('node:child_process');
const read=fs.readFileSync, open=fs.openSync, close=fs.closeSync, sync=fs.fsyncSync, rename=fs.renameSync;
const handles=new Map(), config=()=>JSON.parse(read(${JSON.stringify(fault)},'utf8')).stage;
const fail=code=>Object.assign(new Error('PRIVATE_FAILURE /never/publish'),{code});
fs.openSync=function(name,...args){
 const tmp=typeof name==='string'&&name.includes('.chat_data.json.atomic-');
 if(tmp&&config()==='full')throw fail('ENOSPC');
 const fd=open.call(this,name,...args);
 handles.set(fd,name===${JSON.stringify(runtime)}?'dir':tmp?'temp':'other'); return fd;
};
fs.closeSync=function(fd){handles.delete(fd);return close.call(this,fd);};
fs.renameSync=function(from,to){const result=rename.call(this,from,to);if(to===${JSON.stringify(file)})fs.appendFileSync(${JSON.stringify(writes)},'commit\\n');return result;};
fs.fsyncSync=function(fd){
 if(handles.get(fd)==='dir'&&config()==='dir-sync')throw fail('EIO');
 const result=sync.call(this,fd);
 if(handles.get(fd)==='dir'&&config()==='kill-after-commit')process.kill(process.pid,'SIGKILL');
 return result;
};
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync']){
 const original=cp[name]; cp[name]=function(command,...args){
  if(/codex|opencode|antigravity/i.test(String(command))){fs.writeFileSync(${JSON.stringify(provider)},'attempted');throw new Error('Provider forbidden by test');}
  return original.call(this,command,...args);
 };
}
`);
  const reservation = net.createServer().listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const base = "http://127.0.0.1:" + port;
  let child, logs = "";
  const streams = [];
  async function stop() {
    for (const stream of streams.splice(0)) stream.destroy();
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exiting = once(child, "exit"); child.kill("SIGKILL"); await exiting;
  }
  async function start() {
    child = spawn(process.execPath, ["--require", preload, path.join(server, "server.js")], {
      cwd: server, stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: root, HOST: "127.0.0.1", PORT: String(port), CHAT_AI_RUNTIME_DIR: runtime,
        BUDI_WORKSPACE: path.join(root, "budi"), RIAN_WORKSPACE: path.join(root, "rian"), WORKSTATIONS_DIR: path.join(root, "workstations"),
        NODE_ENV: "test", WAKELOCK_DISABLED: "1" }
    });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", b => { logs = (logs + b).slice(-4000); });
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      try { const r = await fetch(base + "/api/status", { signal: AbortSignal.timeout(250) }); await r.arrayBuffer(); if (r.ok) return; } catch {}
      await sleep(40);
    }
    throw new Error("Disposable retry backend failed to start");
  }
  async function request(route, data) {
    const r = await fetch(base + route, { method: data === undefined ? "GET" : "POST",
      body: data === undefined ? undefined : JSON.stringify(data), headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(3000) });
    return { status: r.status, body: await r.json() };
  }
  async function observe() {
    const events = [];
    await new Promise((resolve, reject) => {
      const req = http.get(base + "/api/events", res => {
        streams.push(res); let pending = "";
        res.on("data", part => {
          pending += part;
          let idx;
          while ((idx = pending.indexOf("\n\n")) >= 0) {
            const block = pending.slice(0, idx); pending = pending.slice(idx + 2);
            const event = block.match(/^event: (.*)$/m)?.[1];
            if (event) events.push(event);
            if (event === "init") resolve();
          }
        }); res.on("error", () => {});
      }); streams.push(req); req.on("error", reject);
    });
    return events;
  }
  t.after(async () => { await stop(); fs.rmSync(root, { recursive: true, force: true }); });
  await start();
  return { request, observe, start, stop, file, runtime, base,
    disk: () => JSON.parse(fs.readFileSync(file, "utf8")),
    bytes: () => fs.readFileSync(file, "utf8"),
    commits: () => fs.existsSync(writes) ? fs.readFileSync(writes, "utf8").trim().split("\n").length : 0,
    fault: stage => fs.writeFileSync(fault, JSON.stringify({ stage })),
    noProviders: () => assert.equal(fs.existsSync(provider), false, "No model invocation"),
    redacted: () => assert.doesNotMatch(logs, /PRIVATE_FAILURE|\/never\/publish/),
    seedOnDisk: record => fs.writeFileSync(file, JSON.stringify(record))
  };
}
const payload = changes => ({ idempotencyKey: "qa-unique-retry-0001", chatId: "group", sender: "user", senderName: "Synthetic owner",
  text: "Private synthetic retry fixture café 👩🏽‍💻", triggerTurn: false, ...changes });
module.exports = { retryBackend, payload, INITIAL, sleep };
