"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { evaluateLoopbackRequest: evaluate, enforceLoopbackRequest: enforce,
  assertLoopbackBind, LocalRequestError } = require("../../agent/loopback-request-policy");
function request({ host = "127.0.0.1:3000", method = "GET", url = "/api/chats", peer = "127.0.0.1", headers = [] } = {}) {
  return { method, url, socket: { remoteAddress: peer }, rawHeaders: ["Host", host, ...headers] };
}
const error = code => err => err instanceof LocalRequestError && err.code === code;

test("CP16 HTTP allows exact loopback authorities, native health and ADB-forwarded ports", () => {
  for (const host of ["127.0.0.1:3000", "localhost:3000", "LOCALHOST:33000", "[::1]:3000", "127.0.0.1", "127.0.0.1:80"]) {
    for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      const result = evaluate(request({ host, peer }));
      assert.equal(result.api, true); assert.equal(result.corsOrigin, null);
      assert.equal(result.url.pathname, "/api/chats");
    }
  }
});

test("CP16 HTTP rejects DNS hosts, lookalikes, numeric abbreviations and malformed authority ports", () => {
  for (const host of ["", "rebound.invalid", "localhost.evil.invalid:3000", "127.0.0.1.evil.invalid:3000", "localhost.:3000",
    "127.1:3000", "2130706433:3000", "0x7f000001:3000", "127.0.0.2:3000", "0.0.0.0:3000", "[::]:3000",
    "127.0.0.1:0", "127.0.0.1:65536", "localhost:003000", "localhost:3000@evil.invalid", "http://localhost:3000", " localhost:3000", "localhost:3000 ", "localhost:3000,evil.invalid"]) {
    assert.throws(() => evaluate(request({ host })), error("LOCAL_HTTP_HOST_DENIED"), host);
  }
});

test("CP16 HTTP remote peers and wildcard bind configuration fail closed", () => {
  for (const peer of [undefined, "10.0.0.1", "192.168.1.2", "::ffff:192.168.1.2", "::2", "127.0.0.2"]) {
    const req = request(); req.socket.remoteAddress = peer;
    assert.throws(() => evaluate(req), error("LOCAL_HTTP_PEER_DENIED"));
  }
  for (const host of ["0.0.0.0", "::", "example.invalid", "192.168.1.2", "127.1", "127.0.0.1:3000", " localhost ", ""]) {
    assert.throws(() => assertLoopbackBind(host), /explicit loopback/);
  }
  for (const host of ["127.0.0.1", "localhost", "::1"]) assert.equal(assertLoopbackBind(host), host);
});

test("CP16 browser origins must match exact scheme host and port, not a localhost alias", () => {
  assert.equal(evaluate(request({ headers: ["Origin", "http://127.0.0.1:3000"] })).corsOrigin, "http://127.0.0.1:3000");
  for (const origin of ["https://127.0.0.1:3000", "http://localhost:3000", "http://127.0.0.1:3001",
    "http://127.0.0.1:3000.evil.invalid", "http://127.0.0.1:3000@evil.invalid", "http://127.1:3000", "http://2130706433:3000"]) {
    assert.throws(() => evaluate(request({ headers: ["Origin", origin] })), error("LOCAL_HTTP_SOURCE_DENIED"));
  }
});

test("CP16 opaque empty multiple and path-bearing origins never fall back to native permission", () => {
  for (const origin of ["null", "", "file://", "https://example.invalid", "http://127.0.0.1:3000/", "http://127.0.0.1:3000?x=1", "http://127.0.0.1:3000 http://evil.invalid", "http://127.0.0.1:3000\\evil"]) {
    assert.throws(() => evaluate(request({ headers: ["Origin", origin] })), error("LOCAL_HTTP_SOURCE_DENIED"));
  }
});

test("CP16 referrer verification works without Origin and cannot be bypassed by contradictory Origin", () => {
  evaluate(request({ headers: ["Referer", "http://127.0.0.1:3000/chat?room=group"] }));
  for (const referer of ["https://evil.invalid/path", "http://localhost:3000/", "http://127.0.0.1:3001/path", "http://127.0.0.1:3000@evil.invalid/", "null", ""]) {
    for (const headers of [["Referer", referer], ["Origin", "http://127.0.0.1:3000", "Referer", referer]]) {
      assert.throws(() => evaluate(request({ headers })), error("LOCAL_HTTP_SOURCE_DENIED"));
    }
  }
});

test("CP16 cross-site or same-site browser metadata rejects reads as well as writes", () => {
  for (const site of ["cross-site", "same-site", "unrecognized", ""]) {
    for (const method of ["GET", "HEAD", "POST", "OPTIONS"]) {
      assert.throws(() => evaluate(request({ method, headers: ["Sec-Fetch-Site", site] })), error("LOCAL_HTTP_SOURCE_DENIED"));
    }
  }
  evaluate(request({ headers: ["Sec-Fetch-Site", "same-origin"] }));
  evaluate(request({ url: "/", headers: ["Sec-Fetch-Site", "none", "Sec-Fetch-Mode", "navigate"] }));
  assert.throws(() => evaluate(request({ headers: ["Sec-Fetch-Mode", "no-cors"] })), error("LOCAL_HTTP_SOURCE_DENIED"));
  for (const dest of ["iframe", "frame", "object", "embed"]) {
    assert.throws(() => evaluate(request({ headers: ["Sec-Fetch-Dest", dest] })), error("LOCAL_HTTP_SOURCE_DENIED"));
  }
});

test("CP16 duplicate security headers are rejected using raw headers before Node can discard them", () => {
  for (const name of ["Host", "Origin", "Referer", "Content-Type", "Sec-Fetch-Site", "Sec-Fetch-Mode", "Access-Control-Request-Headers"]) {
    const headers = name === "Host" ? [name, "localhost:3000"] : [name, "a", name.toLowerCase(), "b"];
    assert.throws(() => evaluate(request({ headers })), error("LOCAL_HTTP_HEADERS_INVALID"));
  }
  for (const rawHeaders of [[], ["Host"], undefined, ["Host", ["127.0.0.1:3000"]]]) {
    const req = request(); req.rawHeaders = rawHeaders;
    assert.throws(() => evaluate(req), error("LOCAL_HTTP_HEADERS_INVALID"));
  }
});

test("CP16 request target cannot be an absolute proxy URL or authority override", () => {
  for (const url of ["http://127.0.0.1:3000/api/chats", "http://evil.invalid/api/chats", "//evil.invalid/api/chats", "\\api\\chats", "/\\evil.invalid", "*", "/api/chats#fragment", "/api/cha ts", "/api/\nchats"]) {
    assert.throws(() => evaluate(request({ url })), error("LOCAL_HTTP_TARGET_INVALID"));
  }
  const url = evaluate(request({ url: "/api/chats?next=https%3A%2F%2Fevil.invalid" })).url;
  assert.equal(url.origin, "http://127.0.0.1:3000");
});

test("CP16 API writes require non-simple JSON media type even without browser headers", () => {
  for (const type of ["application/json", "application/json; utf-8", "Application/JSON; charset=UTF-8", 'application/json; charset="utf-8"']) {
    evaluate(request({ method: "POST", headers: ["Content-Type", type] }));
  }
  for (const type of [undefined, "", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x",
    "application/jsonp", "application/json; charset=latin1", "application/json, text/plain", "application/json; charset=utf-8; other=1"]) {
    assert.throws(() => evaluate(request({ method: "POST", headers: type === undefined ? [] : ["Content-Type", type] })), error("LOCAL_HTTP_JSON_REQUIRED"));
  }
});

test("CP16 preflight and event streaming method gates cannot reach mutation handlers", () => {
  evaluate(request({ method: "OPTIONS", headers: ["Origin", "http://127.0.0.1:3000", "Access-Control-Request-Method", "POST", "Access-Control-Request-Headers", "Content-Type"] }));
  for (const headers of [["Access-Control-Request-Method", "DELETE"], ["Access-Control-Request-Headers", "Authorization"], ["Access-Control-Request-Headers", "Content-Type, X-Other"]]) {
    assert.throws(() => evaluate(request({ method: "OPTIONS", headers })), error("LOCAL_HTTP_PREFLIGHT_DENIED"));
  }
  for (const method of ["PUT", "DELETE", "PATCH", "TRACE"]) {
    assert.throws(() => evaluate(request({ method })), error("LOCAL_HTTP_METHOD_DENIED"));
  }
  for (const method of ["POST", "HEAD"]) {
    assert.throws(() => evaluate(request({ method, url: "/api/events" })), error("LOCAL_HTTP_METHOD_DENIED"));
  }
});

test("CP16 forwarded headers never grant trust to a different Host or browser origin", () => {
  const forwarded = ["X-Forwarded-Host", "127.0.0.1:3000", "Forwarded", "host=127.0.0.1:3000;proto=http", "X-Forwarded-Proto", "http"];
  assert.throws(() => evaluate(request({ host: "evil.invalid:3000", headers: forwarded })), error("LOCAL_HTTP_HOST_DENIED"));
  assert.throws(() => evaluate(request({ headers: [...forwarded, "Origin", "http://evil.invalid:3000"] })), error("LOCAL_HTTP_SOURCE_DENIED"));
});

test("CP16 rejected requests expose stable redacted errors without CORS permission", () => {
  const headers = {}; let code, body, resumed = false;
  const res = { setHeader(k, v) { headers[k.toLowerCase()] = v; }, writeHead(status, h) { code = status; for (const [k,v] of Object.entries(h)) headers[k.toLowerCase()] = v; }, end(value) { body = value; } };
  const req = request({ headers: ["Origin", "http://secret-sensitive.invalid"] }); req.resume = () => { resumed = true; };
  assert.equal(enforce(req, res), null);
  assert.equal(code, 403); assert.equal(resumed, true);
  assert.doesNotMatch(body, /secret-sensitive|invalid/);
  assert.equal(headers["access-control-allow-origin"], undefined);
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["connection"], "close");
  assert.equal(headers["cross-origin-resource-policy"], "same-origin");
  assert.equal(headers["x-frame-options"], "DENY");
});
