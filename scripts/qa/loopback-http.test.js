"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { retryBackend, payload, INITIAL, sleep } = require("./helpers/message-retry-backend");

function raw(base, route, { method = "GET", headers = {}, body = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(base);
    const request = http.request({ hostname: target.hostname, port: target.port, path: route, method,
      headers, agent: false }, response => {
      let value = "";
      if (response.headers["content-type"]?.startsWith("text/event-stream")) {
        response.once("data", bytes => { response.destroy(); clearTimeout(timer);
          resolve({ status: response.statusCode, headers: response.headers, text: bytes.toString(), body: null }); });
      } else {
        response.on("data", bytes => { value += bytes; if (value.length > 1048576) response.destroy(); });
        response.on("end", () => { clearTimeout(timer); let parsed = null;
          try { parsed = JSON.parse(value); } catch {}
          resolve({ status: response.statusCode, headers: response.headers, text: value, body: parsed });
        });
      }
      response.on("error", reject);
    });
    const timer = setTimeout(() => request.destroy(new Error("Bounded test HTTP request timed out")), 4000);
    request.on("error", error => { clearTimeout(timer); reject(error); });
    if (body !== undefined) request.write(typeof body === "string" ? body : JSON.stringify(body));
    request.end();
  });
}

// These two assertions reproduce the old policy gaps on the pinned parent.
test("CP16 localhost rejects a matching attacker Host and Origin instead of reflecting them", { timeout: 10000 }, async t => {
  const server = await retryBackend(t);
  const response = await raw(server.base, "/api/chats", { headers: { Host: "rebound.invalid:3000", Origin: "http://rebound.invalid:3000" } });
  assert.equal(response.status, 403, "An untrusted Host must never build the CORS allowlist");
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.doesNotMatch(response.text, /unrelated|context|rebound/);
  server.noProviders();
});

test("CP16 localhost rejects simple text/plain mutation before persistence or message SSE", { timeout: 10000 }, async t => {
  const server = await retryBackend(t); const events = await server.observe(); const bytes = server.bytes();
  const response = await raw(server.base, "/api/internal/chat-message", { method: "POST", headers: { "Content-Type": "text/plain" }, body: payload() });
  assert.equal(response.status, 415, "Do not parse browser-simple request bodies as trusted JSON");
  assert.equal(server.bytes(), bytes); assert.equal(server.commits(), 0);
  await sleep(30); assert.equal(events.includes("message"), false); server.noProviders();
});


test("CP16 HTTP blocks cross-origin reads including the SSE initial snapshot and disabled endpoints", { timeout: 12000 }, async t => {
  const server = await retryBackend(t); const bytes = server.bytes();
  for (const route of ["/api/status", "/api/chats", "/api/events", "/api/auth/vault", "/api/internal/peer-messages", "/api/files/not-there", "/api/auth/google", "/"]) {
    const response = await raw(server.base, route, { headers: { Origin: "https://outside.invalid" } });
    assert.equal(response.status, 403, route);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
    assert.doesNotMatch(response.text, /unrelated|context|event: init|outside\.invalid/);
  }
  for (const headers of [{ Origin: "null" }, { Referer: "https://outside.invalid/private" },
    { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }, { "Sec-Fetch-Mode": "no-cors" }]) {
    assert.equal((await raw(server.base, "/api/chats", { headers })).status, 403);
  }
  assert.equal(server.bytes(), bytes); assert.equal(server.commits(), 0); server.noProviders();
});

test("CP16 bad browser provenance cannot clear messages, configure models or start agent work", { timeout: 12000 }, async t => {
  const server = await retryBackend(t); const events = await server.observe(); const bytes = server.bytes();
  for (const [route, body] of [["/api/clear", { chatId: "custom" }], ["/api/message", { chatId: "group", text: "never dispatch" }],
    ["/api/config", { topic: "do not apply" }], ["/api/control", { action: "start" }], ["/api/internal/chat-message", payload()]]) {
    const response = await raw(server.base, route, { method: "POST", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" }, body });
    assert.equal(response.status, 403); assert.equal(response.body.code, "LOCAL_HTTP_SOURCE_DENIED");
    assert.equal(server.bytes(), bytes); assert.equal(server.commits(), 0);
  }
  await sleep(40); assert.equal(events.includes("message"), false); server.noProviders();
});

test("CP16 real same-origin JSON still supports durable keyed append and replay with no extra SSE", { timeout: 10000 }, async t => {
  const server = await retryBackend(t); const events = await server.observe();
  const headers = { Origin: server.base, Referer: server.base + "/", "Content-Type": "application/json; charset=UTF-8", "Sec-Fetch-Site": "same-origin" };
  const first = await raw(server.base, "/api/internal/chat-message", { method: "POST", headers, body: payload() });
  assert.equal(first.status, 200); assert.equal(first.body.idempotency.replayed, false);
  assert.equal(first.headers["access-control-allow-origin"], server.base);
  assert.equal(first.headers["cache-control"], "no-store");
  const replay = await raw(server.base, "/api/internal/chat-message", { method: "POST", headers: { ...headers, "Content-Type": "application/json; utf-8" }, body: payload() });
  assert.equal(replay.status, 200); assert.equal(replay.body.idempotency.replayed, true);
  assert.deepEqual(replay.body.message, first.body.message);
  await sleep(30); assert.equal(events.filter(e => e === "message").length, 1);
  assert.equal(server.commits(), 1); server.noProviders();
});

test("CP16 loopback aliases and ADB forwarded port remain usable but aliases are not interchangeable origins", { timeout: 10000 }, async t => {
  const server = await retryBackend(t);
  for (const host of ["localhost:33000", "127.0.0.1:33000", "[::1]:33000"]) {
    const response = await raw(server.base, "/api/status", { headers: { Host: host, Origin: "http://" + host } });
    assert.equal(response.status, 200); assert.equal(response.headers["access-control-allow-origin"], "http://" + host);
  }
  const other = await raw(server.base, "/api/status", { headers: { Origin: server.base.replace("127.0.0.1", "localhost") } });
  assert.equal(other.status, 403);
  assert.equal((await raw(server.base, "/api/status")).status, 200, "Originless native health remains compatible");
  server.noProviders();
});

test("CP16 preflight grants only validated same-origin JSON, with no wildcard credentials or private-network permission", { timeout: 10000 }, async t => {
  const server = await retryBackend(t);
  const headers = { Origin: server.base, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type" };
  const good = await raw(server.base, "/api/internal/chat-message", { method: "OPTIONS", headers });
  assert.equal(good.status, 204); assert.equal(good.headers["access-control-allow-origin"], server.base);
  assert.equal(good.headers["access-control-allow-headers"], "Content-Type");
  assert.equal(good.headers["access-control-allow-credentials"], undefined);
  assert.equal(good.headers["access-control-allow-private-network"], undefined);
  for (const changes of [{ Origin: "https://outside.invalid" }, { "Access-Control-Request-Method": "DELETE" }, { "Access-Control-Request-Headers": "Authorization" }]) {
    const bad = await raw(server.base, "/api/internal/chat-message", { method: "OPTIONS", headers: { ...headers, ...changes } });
    assert.equal(bad.status, 403); assert.equal(bad.headers["access-control-allow-origin"], undefined);
  }
  assert.equal(server.commits(), 0); server.noProviders();
});

test("CP16 duplicate raw security headers and proxy-shaped targets fail without leaking snapshots", { timeout: 10000 }, async t => {
  const server = await retryBackend(t); const host = new URL(server.base).host;
  for (const headers of [["Host", host, "Host", host], ["Host", host, "Origin", server.base, "Origin", "https://outside.invalid"],
    ["Host", host, "Referer", server.base, "Referer", server.base], ["Host", host, "Content-Type", "text/plain", "Content-Type", "application/json"]]) {
    const response = await raw(server.base, "/api/chats", { headers });
    assert.equal(response.status, 400); assert.doesNotMatch(response.text, /unrelated|context/);
  }
  for (const route of [server.base + "/api/chats", "//evil.invalid/api/chats", "/\\evil.invalid/api/chats"]) {
    assert.equal((await raw(server.base, route)).status, 400);
  }
  assert.equal(server.commits(), 0); server.noProviders();
});

test("CP16 requests with proxy-forwarded headers cannot override a rejected Host or source", { timeout: 10000 }, async t => {
  const server = await retryBackend(t); const host = new URL(server.base).host;
  const forwarded = { "X-Forwarded-Host": host, "X-Forwarded-Proto": "http", Forwarded: "host=" + host };
  const bad = await raw(server.base, "/api/chats", { headers: { ...forwarded, Host: "rebound.invalid", Origin: "http://rebound.invalid" } });
  assert.equal(bad.status, 403);
  assert.equal((await raw(server.base, "/api/chats", { headers: { ...forwarded, Origin: "https://outside.invalid" } })).status, 403);
  assert.equal(server.commits(), 0); server.noProviders();
});

test("CP16 existing UI assets stay byte-identical and serve with anti-framing headers", { timeout: 10000 }, async t => {
  const server = await retryBackend(t);
  const original = path.resolve(__dirname, "../../web");
  fs.cpSync(original, path.join(path.dirname(server.runtime), "server/web"), { recursive: true });
  for (const file of ["index.html", "app.js", "style.css"]) {
    const response = await raw(server.base, "/" + file, { headers: { Referer: server.base + "/", "Sec-Fetch-Site": "same-origin" } });
    assert.equal(response.status, 200);
    assert.equal(response.text, fs.readFileSync(path.join(original, file), "utf8"));
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["x-frame-options"], "DENY");
    assert.equal(response.headers["content-security-policy"], "frame-ancestors 'none'");
  }
  server.noProviders();
});

test("CP16 unapproved HTTP methods and non-GET event streams are denied before handlers", { timeout: 10000 }, async t => {
  const server = await retryBackend(t);
  for (const method of ["PUT", "PATCH", "DELETE", "TRACE"]) {
    const response = await raw(server.base, "/api/chats", { method });
    assert.equal(response.status, 405); assert.equal(response.headers.allow, "GET, HEAD, POST, OPTIONS");
  }
  assert.equal((await raw(server.base, "/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: {} })).status, 405);
  assert.equal((await raw(server.base, "/api/events", { method: "HEAD" })).status, 405);
  assert.equal(server.commits(), 0); server.noProviders();
});


test("CP16 shared Android HTTP boundary probe passes against a real backend without changing chat", { timeout: 12000 }, async t => {
  const server = await retryBackend(t); const original = server.bytes();
  const probe = path.join(__dirname, "loopback-http-probe.py");
  const child = spawn("python3", [probe, "--isolated-test", "--base-url", server.base], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", b => { output += b; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 8000);
  const [exit] = await once(child, "exit"); clearTimeout(timer);
  assert.equal(exit, 0, output);
  assert.match(output, /CP16_LOCAL_HTTP_BOUNDARY_PASS rejected=13 same_origin=1 native=1/);
  assert.equal(server.bytes(), original); assert.equal(server.commits(), 0);
  server.noProviders();
});

test("CP16 boundary probe cannot be activated outside the existing explicit emulator CI gate", () => {
  const script = fs.readFileSync(path.join(__dirname, "android-emulator-smoke.sh"), "utf8");
  const call = script.indexOf("python3 scripts/qa/loopback-http-probe.py");
  assert.ok(call > script.indexOf("CP16_CHAT_PERSISTENCE_REQUIRES_ISOLATED_CI"));
  assert.ok(call > script.indexOf("CP16_CHAT_PERSISTENCE_REQUIRES_EMULATOR"));
  assert.ok(call < script.indexOf("chat-persistence-probe.py seed"));
  const implementation = fs.readFileSync(path.resolve(__dirname, "../../server.js"), "utf8");
  assert.ok(implementation.indexOf("const url = enforceLoopbackRequest(req, res)") < implementation.indexOf('url.pathname === "/api/internal/chat-message"'));
  assert.doesNotMatch(implementation, /http:\$\{host\}|const allowed = new Set/);
});
