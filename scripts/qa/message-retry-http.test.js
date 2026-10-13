"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { retryBackend, payload, INITIAL, sleep } = require("./helpers/message-retry-backend");
const { MAX_RECEIPTS, prepareMessageRequest } = require("../../agent/message-receipts");
const ROUTE = "/api/internal/chat-message";

test("CP16 real HTTP retries after restart return one exact message without extra writes or SSE", { timeout: 12000 }, async t => {
  const server = await retryBackend(t); const events = await server.observe();
  const data = payload({ type: "voice_note", duration: "00:07", quoted: { id: "quoted", text: "exact quote" } });
  const first = await server.request(ROUTE, data);
  assert.equal(first.status, 200); assert.equal(first.body.idempotency.replayed, false);
  const bytes = server.bytes(); const commits = server.commits();
  const repeats = await Promise.all(Array.from({ length: 8 }, () => server.request(ROUTE, data)));
  for (const response of repeats) {
    assert.equal(response.status, 200); assert.equal(response.body.idempotency.replayed, true);
    assert.deepEqual(response.body.message, first.body.message);
  }
  await sleep(50);
  assert.equal(events.filter(e => e === "message").length, 1);
  assert.equal(server.bytes(), bytes); assert.equal(server.commits(), commits);
  await server.stop(); await server.start();
  const restarted = await server.request(ROUTE, data);
  assert.equal(restarted.body.idempotency.replayed, true);
  assert.deepEqual(restarted.body.message, first.body.message);
  assert.equal(server.bytes(), bytes); assert.equal(server.commits(), commits);
  const disk = server.disk(); assert.equal(disk.chats.group.length, 1); assert.equal(disk.messageReceipts.entries.length, 1);
  assert.deepEqual(disk.chats.custom, INITIAL.chats.custom);
  assert.equal((await server.request("/api/chats")).body.messageReceipts, undefined, "Receipt ledger is not a public chat field");
  server.noProviders(); server.redacted();
});

test("CP16 simultaneous identical first requests commit only one new message", { timeout: 10000 }, async t => {
  const server = await retryBackend(t);
  const responses = await Promise.all(Array.from({ length: 10 }, () => server.request(ROUTE, payload())));
  assert.equal(responses.filter(r => r.body.idempotency.replayed === false).length, 1);
  assert.equal(new Set(responses.map(r => r.body.message.id)).size, 1);
  assert.equal(server.commits(), 1); assert.equal(server.disk().messageReceipts.entries.length, 1);
  server.noProviders();
});

test("CP16 mismatched key reuse conflicts without exposing original content, room keys do not collide", { timeout: 10000 }, async t => {
  const server = await retryBackend(t);
  const first = await server.request(ROUTE, payload()); assert.equal(first.status, 200);
  const bytes = server.bytes();
  for (const changes of [{ text: "changed" }, { senderName: "different" }, { quoted: { text: "quote" } }, { type: "voice_note" }]) {
    const response = await server.request(ROUTE, payload(changes));
    assert.equal(response.status, 409); assert.equal(response.body.code, "CHAT_IDEMPOTENCY_CONFLICT");
    assert.doesNotMatch(JSON.stringify(response.body), /synthetic retry fixture|msg-|qa-unique/);
    assert.equal(server.bytes(), bytes);
  }
  const other = await server.request(ROUTE, payload({ chatId: "direct_budi" }));
  assert.equal(other.status, 200); assert.equal(other.body.idempotency.replayed, false);
  assert.notEqual(other.body.message.id, first.body.message.id);
  assert.equal(server.disk().messageReceipts.entries.length, 2);
  server.noProviders();
});

test("CP16 full-storage failure leaves neither message nor receipt; explicit retry after recovery commits once", { timeout: 10000 }, async t => {
  const server = await retryBackend(t); const events = await server.observe(); const bytes = server.bytes();
  server.fault("full");
  const response = await server.request(ROUTE, payload());
  assert.equal(response.status, 507); assert.equal(response.body.committed, false);
  assert.equal(server.bytes(), bytes); assert.equal(server.commits(), 0);
  assert.equal((await server.request("/api/chats")).body.chats.group.length, 0);
  await sleep(20); assert.equal(events.includes("message"), false);
  server.fault(null);
  const accepted = await server.request(ROUTE, payload()); assert.equal(accepted.body.idempotency.replayed, false);
  const replay = await server.request(ROUTE, payload()); assert.equal(replay.body.idempotency.replayed, true);
  assert.deepEqual(accepted.body.message, replay.body.message);
  assert.equal(server.commits(), 1); assert.equal(server.disk().messageReceipts.entries.length, 1);
  server.noProviders(); server.redacted();
});

test("CP16 post-rename uncertainty blocks retries until reload, then resolves to the existing message", { timeout: 10000 }, async t => {
  const server = await retryBackend(t); server.fault("dir-sync");
  const uncertain = await server.request(ROUTE, payload());
  assert.equal(uncertain.status, 503); assert.equal(uncertain.body.code, "CHAT_STORAGE_COMMIT_UNCERTAIN");
  assert.equal(uncertain.body.committed, true);
  const disk = server.disk(); assert.equal(disk.messageReceipts.entries.length, 1);
  server.fault(null);
  const blocked = await server.request(ROUTE, payload());
  assert.equal(blocked.body.code, "CHAT_STORAGE_RECONCILIATION_REQUIRED");
  await server.stop(); await server.start();
  const replay = await server.request(ROUTE, payload());
  assert.equal(replay.status, 200); assert.equal(replay.body.idempotency.replayed, true);
  assert.deepEqual(replay.body.message, disk.chats.group[0]);
  assert.equal(server.commits(), 1);
  server.noProviders(); server.redacted();
});

test("CP16 real SIGKILL after directory fsync but before HTTP acknowledgement does not duplicate on retry", { timeout: 12000 }, async t => {
  const server = await retryBackend(t); server.fault("kill-after-commit");
  await assert.rejects(server.request(ROUTE, payload()));
  await server.stop(); server.fault(null); await server.start();
  const disk = server.disk(); assert.equal(disk.chats.group.length, 1); assert.equal(disk.messageReceipts.entries.length, 1);
  const replay = await server.request(ROUTE, payload());
  assert.equal(replay.status, 200); assert.equal(replay.body.idempotency.replayed, true);
  assert.deepEqual(replay.body.message, disk.chats.group[0]); assert.equal(server.commits(), 1);
  server.noProviders();
});

test("CP16 cleared and subsequently edited messages are not resurrected or silently replayed", { timeout: 12000 }, async t => {
  const server = await retryBackend(t); const first = await server.request(ROUTE, payload());
  const cleared = await server.request("/api/clear", { chatId: "group" }); assert.equal(cleared.status, 200);
  const afterClear = server.bytes();
  const gone = await server.request(ROUTE, payload());
  assert.equal(gone.status, 410); assert.equal(gone.body.code, "CHAT_IDEMPOTENCY_MESSAGE_GONE"); assert.equal(server.bytes(), afterClear);
  await server.stop(); await server.start();
  assert.equal((await server.request(ROUTE, payload())).status, 410);
  await server.stop();
  const edited = server.disk(); edited.chats.group = [{ ...first.body.message, text: "Edited fixture" }];
  server.seedOnDisk(edited); await server.start();
  const changed = await server.request(ROUTE, payload());
  assert.equal(changed.status, 409); assert.equal(changed.body.code, "CHAT_IDEMPOTENCY_MESSAGE_CHANGED");
  assert.equal(server.disk().chats.group[0].text, "Edited fixture");
  server.noProviders();
});

test("CP16 legacy unkeyed requests still append, but keyed invalid or triggered requests fail before any mutation", { timeout: 10000 }, async t => {
  const server = await retryBackend(t); const unkeyed = payload(); delete unkeyed.idempotencyKey;
  const a = await server.request(ROUTE, unkeyed); const b = await server.request(ROUTE, unkeyed);
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.notEqual(a.body.message.id, b.body.message.id);
  assert.equal(a.body.idempotency, undefined); assert.equal(server.disk().messageReceipts.entries.length, 0);
  const bytes = server.bytes();
  for (const change of [{ idempotencyKey: null }, { idempotencyKey: "" }, { triggerTurn: true }, { triggerTurn: undefined },
    { sender: "ai1" }, { chatId: "direct_zovia" }, { chatId: "peer" }, { text: "x".repeat(65537) }]) {
    const invalid = await server.request(ROUTE, payload(change)); assert.equal(invalid.status, 400);
    assert.equal(invalid.body.success, false); assert.equal(server.bytes(), bytes);
  }
  server.noProviders();
});

test("CP16 malformed persisted receipt ledger makes startup read-only rather than permitting duplicates", { timeout: 8000 }, async t => {
  const seed = { ...structuredClone(INITIAL), messageReceipts: { schemaVersion: 1, entries: [{ keyHash: "corrupt" }] } };
  const server = await retryBackend(t, seed); const bytes = server.bytes();
  assert.equal((await server.request("/api/status")).body.chatStorage.state, "unavailable");
  const blocked = await server.request(ROUTE, payload());
  assert.equal(blocked.body.code, "CHAT_STORAGE_UNREADABLE"); assert.equal(server.bytes(), bytes);
  server.noProviders();
});

test("CP16 full receipt capacity cannot evict evidence or grow on retries", { timeout: 12000 }, async t => {
  const seed = structuredClone(INITIAL);
  seed.messageReceipts = { schemaVersion: 1, entries: Array.from({ length: MAX_RECEIPTS }, (_, i) => {
    const req = prepareMessageRequest(payload({ idempotencyKey: "capacity-seeded-" + i }));
    return { keyHash: req.keyHash, payloadHash: req.payloadHash, chatId: "group", sender: "user", messageId: "old-" + i };
  }) };
  const server = await retryBackend(t, seed); const bytes = server.bytes();
  const blocked = await server.request(ROUTE, payload());
  assert.equal(blocked.status, 503); assert.equal(blocked.body.code, "CHAT_IDEMPOTENCY_CAPACITY");
  assert.equal(blocked.body.retryable, false); assert.equal(server.bytes(), bytes); assert.equal(server.commits(), 0);
  server.noProviders();
});
