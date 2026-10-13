"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { once } = require("node:events");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
const probe = path.join(__dirname, "chat-persistence-probe.py");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runProbe(args, timeout = 10000) {
  // Asynchronous: verification may target an HTTP process on this test runner.
  const child = spawn("python3", [probe, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", b => { output = (output + b).slice(-2000); });
  const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
  try {
    const [code] = await once(child, "exit");
    return { code, output };
  } finally { clearTimeout(timer); }
}

async function killChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

async function unusedPort() {
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(e => e ? reject(e) : resolve()));
  return port;
}

test("CP16 real backend preserves acknowledged chat payloads across three SIGKILL restarts", { timeout: 30000 }, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "v2-chat-restart-"));
  const serverDir = path.join(temporary, "server");
  const runtimeDir = path.join(temporary, "runtime");
  fs.mkdirSync(serverDir);
  fs.mkdirSync(runtimeDir);
  fs.copyFileSync(path.join(root, "server.js"), path.join(serverDir, "server.js"));
  fs.cpSync(path.join(root, "agent"), path.join(serverDir, "agent"), { recursive: true });
  const persistedPath = path.join(runtimeDir, "chat_data.json");
  const original = {
    topic: "Persistence regression fixture", statuses: [], calls: [], internalPeer: [],
    chats: { group: [{ id: "old-group", chatId: "group", text: "Legacy fixture" }],
      direct_budi: [{ id: "old-budi", chatId: "direct_budi", text: "Legacy Budi fixture" }],
      direct_rian: [{ id: "old-rian", chatId: "direct_rian", text: "Legacy Rian fixture" }],
      custom_room: [{ id: "unrelated", text: "Untouched custom room" }] },
    contextMemory: { group: "Existing context", direct_budi: "Private Budi context", direct_rian: "Private Rian context" }
  };
  fs.writeFileSync(persistedPath, JSON.stringify(original));
  const tripwire = path.join(temporary, "provider-attempted");
  const preload = path.join(temporary, "no-providers.cjs");
  fs.writeFileSync(preload, `const fs=require('node:fs'), cp=require('node:child_process');
for(const name of ['spawn','spawnSync','execFile','execFileSync','exec','execSync']){
 const original=cp[name]; cp[name]=function(command,...args){
  if(/(?:codex|opencode|antigravity)/i.test(String(command))){
   fs.writeFileSync(${JSON.stringify(tripwire)},'provider process attempted');
   throw new Error('Provider calls prohibited by isolated persistence QA');
  }
  return original.call(this,command,...args);
 };
}`);
  const port = await unusedPort();
  const base = "http://127.0.0.1:" + port;
  const proofPath = path.join(temporary, "expected.json");
  let child;
  t.after(async () => { await killChild(child); fs.rmSync(temporary, { recursive: true, force: true }); });
  async function startServer() {
    // Deliberately do not inherit API keys, OAuth credentials, NODE_OPTIONS or HOME.
    child = spawn(process.execPath, ["--require", preload, path.join(serverDir, "server.js")], {
      cwd: serverDir,
      env: { PATH: process.env.PATH, HOME: temporary, HOST: "127.0.0.1", PORT: String(port),
        CHAT_AI_RUNTIME_DIR: runtimeDir, BUDI_WORKSPACE: path.join(temporary, "budi"),
        RIAN_WORKSPACE: path.join(temporary, "rian"), WORKSTATIONS_DIR: path.join(temporary, "workstations"),
        WAKELOCK_DISABLED: "1", NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      try {
        const response = await fetch(base + "/api/status", { signal: AbortSignal.timeout(250) });
        await response.arrayBuffer();
        if (response.status === 200) return;
      } catch {}
      await sleep(50);
    }
    assert.fail("Isolated backend did not become healthy");
  }
  await startServer();
  const seeded = await runProbe(["seed", "--isolated-test", "--base-url", base, "--proof", proofPath]);
  assert.equal(seeded.code, 0, seeded.output);
  assert.match(seeded.output, /CP16_CHAT_PERSISTENCE_SEEDED count=5/);
  assert.equal(fs.statSync(proofPath).mode & 0o777, 0o600, "Private proof permissions");
  const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
  for (let cycle = 0; cycle < 3; cycle++) {
    const oldPid = child.pid;
    await killChild(child);
    await startServer();
    assert.notEqual(child.pid, oldPid, "A new process must read the same disk state");
    const result = await runProbe(["verify", "--isolated-test", "--base-url", base, "--proof", proofPath]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /CP16_CHAT_PERSISTENCE_PASS count=5/);
    assert.match(result.output, /CP16_MESSAGE_RETRY_REPLAY_PASS count=3/);
    const disk = JSON.parse(fs.readFileSync(persistedPath, "utf8"));
    for (const room of ["group", "direct_budi", "direct_rian"]) assert.deepEqual(disk.chats[room], proof.expectedRooms[room]);
    assert.deepEqual(disk.chats.custom_room, original.chats.custom_room);
    assert.deepEqual(disk.contextMemory, original.contextMemory);
  }
  assert.equal(fs.existsSync(tripwire), false, "No provider process may run");
});

test("CP16 persistence probe rejects unapproved or remote targets before making requests", async () => {
  const noOptIn = await runProbe(["seed", "--base-url", "http://127.0.0.1:1", "--proof", "/nonexistent/proof"]);
  assert.equal(noOptIn.code, 60);
  assert.match(noOptIn.output, /isolated-test opt-in required/);
  const remote = await runProbe(["seed", "--isolated-test", "--base-url", "http://example.org:3000", "--proof", "/nonexistent/proof"]);
  assert.equal(remote.code, 60);
  assert.match(remote.output, /loopback/);
});

test("CP16 persistence negative controls reject loss, duplication, changed quotes and room leakage", { timeout: 5000 }, async () => {
  const child = spawn("python3", ["-m", "unittest", "discover", "-s", __dirname, "-p", "chat_persistence_probe_test.py"], {
    stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", b => { output += b; });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, output);
  assert.match(output, /Ran 8 tests/);
  assert.match(output, /OK/);
});


test("CP16 Android fixture gate requires isolated CI and emulator before any chat write", () => {
  const smoke = fs.readFileSync(path.join(__dirname, "android-emulator-smoke.sh"), "utf8");
  const seed = smoke.indexOf("chat-persistence-probe.py seed");
  const restart = smoke.indexOf('echo "CP16_RESTART_BEGIN=');
  const verify = smoke.indexOf("chat-persistence-probe.py verify");
  assert.ok(seed > smoke.indexOf("CP16_CHAT_PERSISTENCE_REQUIRES_ISOLATED_CI"));
  assert.ok(seed > smoke.indexOf("CP16_CHAT_PERSISTENCE_REQUIRES_EMULATOR"));
  assert.ok(seed > 0 && restart > seed && verify > restart);
  assert.match(smoke, /mktemp -d/);
  assert.match(smoke, /rm -rf -- "\$PERSISTENCE_DIR"/);
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  const artifacts = workflow.slice(workflow.indexOf("name: Upload runtime smoke evidence"));
  assert.doesNotMatch(artifacts, /runtime-chats\.json|expected\.json|chat_data\.json|cp16-chat-persistence/);
});


test("CP16 desktop CI must execute baseline contracts, not only the old smoke script", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /run: npm test/);
  assert.match(pkg.scripts.test, /&& npm run qa:baseline$/);
  assert.doesNotMatch(pkg.scripts["qa:baseline"], /npm test/);
});
