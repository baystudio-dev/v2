"use strict";

// This is a browser/HTTP boundary, NOT caller authentication. A local native
// process can forge these headers and still needs future capability auth.
const PEERS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LISTEN = new Set(["127.0.0.1", "::1", "localhost"]);
const METHODS = new Set(["GET", "HEAD", "POST", "OPTIONS"]);
const SINGLETONS = new Set(["host", "origin", "referer", "content-type", "sec-fetch-site", "sec-fetch-mode",
  "sec-fetch-dest", "access-control-request-method", "access-control-request-headers"]);
const ERRORS = Object.freeze({
  LOCAL_HTTP_PEER_DENIED: [403, "Koneksi harus berasal dari loopback lokal."],
  LOCAL_HTTP_HOST_DENIED: [403, "Alamat tujuan HTTP tidak diizinkan."],
  LOCAL_HTTP_SOURCE_DENIED: [403, "Asal request browser tidak diizinkan."],
  LOCAL_HTTP_HEADERS_INVALID: [400, "Header request ambigu atau tidak valid."],
  LOCAL_HTTP_TARGET_INVALID: [400, "Target request tidak valid."],
  LOCAL_HTTP_METHOD_DENIED: [405, "Metode HTTP tidak didukung."],
  LOCAL_HTTP_JSON_REQUIRED: [415, "Mutasi API memerlukan Content-Type application/json UTF-8."],
  LOCAL_HTTP_PREFLIGHT_DENIED: [403, "Preflight request tidak diizinkan."]
});
class LocalRequestError extends Error {
  constructor(code) {
    super(ERRORS[code][1]); this.name = "LocalRequestError";
    this.code = code; this.statusCode = ERRORS[code][0];
  }
  toPublic() { return { success: false, code: this.code, error: this.message }; }
}
function deny(code) { throw new LocalRequestError(code); }
function assertLoopbackBind(host) {
  if (typeof host !== "string" || !LISTEN.has(host)) throw new Error("HTTP listener requires an explicit loopback address");
  return host;
}
function authority(value) {
  if (typeof value !== "string") return null;
  // Reject DNS names, trailing dots, numeric abbreviations and URL userinfo.
  // ADB forwards may legitimately use a different port, but never a new host.
  const match = /^(127\.0\.0\.1|localhost|\[::1\])(?::([1-9][0-9]{0,4}))?$/i.exec(value);
  if (!match || (match[2] && Number(match[2]) > 65535)) return null;
  const host = match[1].toLowerCase();
  const port = match[2] ? Number(match[2]) : 80;
  return "http://" + host + (port === 80 ? "" : ":" + port);
}
function sourceOrigin(value, referrer = false) {
  if (typeof value !== "string" || /[\s\\]/.test(value)) return null;
  const match = /^http:\/\/([^/?#]+)(.*)$/i.exec(value);
  if (!match || (!referrer && match[2] !== "") || (referrer && match[2].includes("#"))) return null;
  return authority(match[1]);
}
function headerValues(req) {
  const values = {};
  const seen = new Set();
  if (!Array.isArray(req.rawHeaders) || req.rawHeaders.length % 2 !== 0) deny("LOCAL_HTTP_HEADERS_INVALID");
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = String(req.rawHeaders[i]).toLowerCase();
    if (!SINGLETONS.has(name)) continue;
    const value = req.rawHeaders[i + 1];
    if (seen.has(name) || typeof value !== "string" || /[\r\n\0]/.test(value)) deny("LOCAL_HTTP_HEADERS_INVALID");
    seen.add(name); values[name] = value;
  }
  if (!seen.has("host")) deny("LOCAL_HTTP_HEADERS_INVALID");
  return values;
}
function evaluateLoopbackRequest(req) {
  if (!PEERS.has(req.socket?.remoteAddress)) deny("LOCAL_HTTP_PEER_DENIED");
  const h = headerValues(req);
  const origin = authority(h.host);
  if (!origin) deny("LOCAL_HTTP_HOST_DENIED");
  // Accept origin-form requests only; absolute/proxy/authority-form cannot
  // influence URL parsing or route a request through another origin.
  if (typeof req.url !== "string" || !req.url.startsWith("/") || req.url.startsWith("//") ||
      /[\s\\#\u0000-\u001f\u007f]/.test(req.url)) deny("LOCAL_HTTP_TARGET_INVALID");
  let url;
  try { url = new URL(req.url, origin); } catch { deny("LOCAL_HTTP_TARGET_INVALID"); }
  if (url.origin !== origin) deny("LOCAL_HTTP_TARGET_INVALID");
  const api = /^\/api(?:\/|$)/.test(url.pathname);
  const site = h["sec-fetch-site"];
  // A same-site but different localhost port is still an untrusted app origin.
  if (site !== undefined && !["same-origin", "none"].includes(site)) deny("LOCAL_HTTP_SOURCE_DENIED");
  if (h.origin !== undefined && sourceOrigin(h.origin) !== origin) deny("LOCAL_HTTP_SOURCE_DENIED");
  if (h.referer !== undefined && sourceOrigin(h.referer, true) !== origin) deny("LOCAL_HTTP_SOURCE_DENIED");
  if (api && (h["sec-fetch-mode"] === "no-cors" || ["iframe", "frame", "object", "embed"].includes(h["sec-fetch-dest"]))) {
    deny("LOCAL_HTTP_SOURCE_DENIED");
  }
  if (!METHODS.has(req.method) || (url.pathname === "/api/events" && !["GET", "OPTIONS"].includes(req.method))) {
    deny("LOCAL_HTTP_METHOD_DENIED");
  }
  if (req.method === "OPTIONS") {
    if (h["access-control-request-method"] !== undefined && !["GET", "HEAD", "POST"].includes(h["access-control-request-method"])) {
      deny("LOCAL_HTTP_PREFLIGHT_DENIED");
    }
    if (h["access-control-request-headers"] !== undefined) {
      const names = h["access-control-request-headers"].split(",").map(v => v.trim().toLowerCase());
      if (!names.length || names.some(n => n !== "content-type")) deny("LOCAL_HTTP_PREFLIGHT_DENIED");
    }
  }
  // QuickReplyReceiver and TerminalFeedbackManager currently send the legacy
  // non-simple media type "application/json; utf-8". Retain that exact form
  // until those clients are corrected, without accepting text/plain or forms.
  if (api && req.method === "POST" && !/^application\/json(?:\s*;\s*(?:charset\s*=\s*(?:utf-8|"utf-8")|utf-8))?\s*$/i.test(h["content-type"] || "")) {
    deny("LOCAL_HTTP_JSON_REQUIRED");
  }
  // Missing browser provenance is a documented native/CLI compatibility path,
  // not a statement of identity. JSON-only API writes prevent simple forms.
  return { url, api, corsOrigin: h.origin === undefined ? null : origin, preflight: req.method === "OPTIONS" };
}
function enforceLoopbackRequest(req, res) {
  res.setHeader("Vary", "Origin, Referer, Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  try {
    const policy = evaluateLoopbackRequest(req);
    if (policy.api) res.setHeader("Cache-Control", "no-store");
    if (policy.corsOrigin) res.setHeader("Access-Control-Allow-Origin", policy.corsOrigin);
    if (policy.preflight) {
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.writeHead(204); res.end(); return null;
    }
    return policy.url;
  } catch (error) {
    if (!(error instanceof LocalRequestError)) throw error;
    // Never reflect rejected host/source/payload/credentials or emit them to logs.
    res.writeHead(error.statusCode, { "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store", Connection: "close",
      ...(error.statusCode === 405 ? { Allow: "GET, HEAD, POST, OPTIONS" } : {}) });
    res.end(JSON.stringify(error.toPublic()));
    req.resume();
    return null;
  }
}
module.exports = { LocalRequestError, assertLoopbackBind, evaluateLoopbackRequest, enforceLoopbackRequest };
