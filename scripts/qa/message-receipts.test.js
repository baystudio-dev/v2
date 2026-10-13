"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { prepareMessageRequest, emptyReceipts, validateMessageReceipts, appendMessageReceipt,
  findMessageReplay, MessageReceiptError, MAX_RECEIPTS } = require("../../agent/message-receipts");
const { validateChatRecord } = require("../../agent/atomic-chat-store");
const input = changes => ({ idempotencyKey: "fixture-key-0001", chatId: "group", sender: "user",
  senderName: "Synthetic owner", text: "Unicode: café 日本語 👩🏽‍💻\nline 2", triggerTurn: false, ...changes });
function applied(data = input()) {
  const request = prepareMessageRequest(data);
  const message = { ...request.fields, id: "msg-fixed", side: "right", model: null, time: "12:00", ticks: true };
  const receipts = emptyReceipts(); appendMessageReceipt(receipts, request, message.id);
  return { request, message, receipts, chats: { group: [message], direct_budi: [], direct_rian: [] } };
}
function code(expected) { return error => error instanceof MessageReceiptError && error.code === expected; }

test("CP16 message receipt uses canonical payload and hashed room/sender-scoped keys", () => {
  const a = prepareMessageRequest(input({ quoted: { id: "original", text: "quote", extra: { a: 1, b: 2 } } }));
  const b = prepareMessageRequest(input({ quoted: { extra: { b: 2, a: 1 }, text: "quote", id: "original" } }));
  assert.equal(a.payloadHash, b.payloadHash);
  assert.equal(a.keyHash, b.keyHash);
  assert.notEqual(a.keyHash, prepareMessageRequest(input({ chatId: "direct_budi" })).keyHash);
  assert.notEqual(a.payloadHash, prepareMessageRequest(input({ text: "different" })).payloadHash);
  assert.equal(a.keyHash.length, 64);
  assert.doesNotMatch(JSON.stringify(applied().receipts), /fixture-key|Unicode|line 2/);
});

test("CP16 keyed append explicitly rejects triggered model work and peer/private impersonation scopes", () => {
  for (const change of [{ triggerTurn: true }, { triggerTurn: undefined }, { sender: "ai1" }, { sender: "ai2" },
    { chatId: "direct_zovia" }, { chatId: "peer" }, { chatId: "internal" }, { chatId: "__proto__" }]) {
    assert.throws(() => prepareMessageRequest(input(change)), code("CHAT_IDEMPOTENCY_SCOPE_UNSUPPORTED"));
  }
});

test("CP16 key and payload validation is bounded with redacted errors", () => {
  for (const change of [{ idempotencyKey: "x" }, { idempotencyKey: "a".repeat(129) }, { idempotencyKey: {} },
    { idempotencyKey: "secret / key" }, { senderName: [] }, { type: "arbitrary-file" }, { quoted: [] },
    { text: "" }, { text: "a".repeat(65537) }, { duration: {} }, { futureSideEffect: "private" }]) {
    assert.throws(() => prepareMessageRequest(input(change)), error => {
      assert.equal(error.code, "CHAT_IDEMPOTENCY_INVALID");
      assert.doesNotMatch(JSON.stringify(error.toPublic()), /secret|futureSideEffect|Unicode/);
      return true;
    });
  }
  let deep = { value: "data" }; for (let i = 0; i < 10; i++) deep = { nested: deep };
  assert.throws(() => prepareMessageRequest(input({ quoted: deep })), code("CHAT_IDEMPOTENCY_INVALID"));
});

test("CP16 replay returns a defensive copy and mismatch does not expose earlier content", () => {
  const x = applied();
  const replay = findMessageReplay(x.receipts, x.chats, x.request);
  assert.deepEqual(replay, x.message); replay.text = "tampered";
  assert.notEqual(x.message.text, replay.text);
  assert.throws(() => findMessageReplay(x.receipts, x.chats, prepareMessageRequest(input({ text: "other" }))), code("CHAT_IDEMPOTENCY_CONFLICT"));
});

test("CP16 receipt survives message removal and refuses to resurrect or return an edited message", () => {
  const x = applied(); x.chats.group = [];
  assert.throws(() => findMessageReplay(x.receipts, x.chats, x.request), code("CHAT_IDEMPOTENCY_MESSAGE_GONE"));
  x.chats.group = [{ ...x.message, text: "edited" }];
  assert.throws(() => findMessageReplay(x.receipts, x.chats, x.request), code("CHAT_IDEMPOTENCY_MESSAGE_CHANGED"));
});

test("CP16 legacy snapshots without receipts remain valid; malformed or duplicate receipt state fails closed", () => {
  validateChatRecord({ chats: { group: [] } });
  const good = applied().receipts; validateChatRecord({ messageReceipts: good });
  for (const bad of [null, [], {}, { ...good, schemaVersion: 2 }, { ...good, entries: [good.entries[0], good.entries[0]] },
    { ...good, entries: [{ ...good.entries[0], keyHash: [good.entries[0].keyHash] }] },
    { ...good, entries: [{ ...good.entries[0], sender: "ai1" }] },
    { ...good, entries: [{ ...good.entries[0], payloadHash: "not-a-hash" }] }]) {
    assert.throws(() => validateMessageReceipts(bad));
    assert.throws(() => validateChatRecord({ messageReceipts: bad }));
  }
});

test("CP16 receipt capacity fails closed without eviction while existing replay remains available", () => {
  const x = applied();
  for (let i = 1; i < MAX_RECEIPTS; i++) {
    const req = prepareMessageRequest(input({ idempotencyKey: "capacity-" + i }));
    appendMessageReceipt(x.receipts, req, "msg-" + i);
  }
  validateMessageReceipts(x.receipts);
  assert.throws(() => appendMessageReceipt(x.receipts, prepareMessageRequest(input({ idempotencyKey: "capacity-overflow" })), "overflow"), code("CHAT_IDEMPOTENCY_CAPACITY"));
  assert.equal(x.receipts.entries.length, MAX_RECEIPTS);
  assert.deepEqual(findMessageReplay(x.receipts, x.chats, x.request), x.message);
});
