"use strict";

const { createHash } = require("node:crypto");
const MAX_RECEIPTS = 2048;
const ROOMS = new Set(["group", "direct_budi", "direct_rian"]);
const REQUEST_KEYS = new Set(["idempotencyKey", "chatId", "sender", "senderName", "text", "type", "duration", "quoted", "triggerTurn"]);
const HASH = /^[a-f0-9]{64}$/;
const CODES = Object.freeze({
  CHAT_IDEMPOTENCY_INVALID: [400, "Permintaan berkunci tidak valid."],
  CHAT_IDEMPOTENCY_SCOPE_UNSUPPORTED: [400, "Kunci pesan saat ini hanya didukung untuk pesan user ke room legacy dengan triggerTurn=false."],
  CHAT_IDEMPOTENCY_CONFLICT: [409, "Kunci permintaan sudah digunakan untuk isi pesan berbeda."],
  CHAT_IDEMPOTENCY_MESSAGE_GONE: [410, "Pesan dari permintaan ini sudah tidak tersedia. Pengiriman ulang tidak membuat pesan baru."],
  CHAT_IDEMPOTENCY_MESSAGE_CHANGED: [409, "Pesan tersimpan sudah berubah. Periksa riwayat; pengiriman ulang tidak diterapkan."],
  CHAT_IDEMPOTENCY_CAPACITY: [503, "Batas bukti permintaan tercapai. Tidak ada bukti lama yang dihapus otomatis."],
});
class MessageReceiptError extends Error {
  constructor(code) {
    const info = CODES[code];
    if (!info) throw new TypeError("Unknown receipt error");
    super(info[1]); this.code = code; this.statusCode = info[0];
  }
  toPublic() { return { success: false, code: this.code, error: this.message, retryable: false }; }
}
const invalid = () => { throw new MessageReceiptError("CHAT_IDEMPOTENCY_INVALID"); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
function canonical(value, depth = 0) {
  if (depth > 8) return invalid();
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(v => canonical(v, depth + 1)).join(",") + "]";
  if (object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k], depth + 1)).join(",") + "}";
  }
  return invalid();
}
const digest = value => createHash("sha256").update(canonical(value), "utf8").digest("hex");
const boundedText = (value, bytes, empty = false) => typeof value === "string" && (empty || value.length > 0) && Buffer.byteLength(value, "utf8") <= bytes;

/** Strict additive contract. Unkeyed callers retain the existing route behavior.
 * This is append idempotency, not user authentication or a tool-execution receipt.
 */
function prepareMessageRequest(data) {
  if (!object(data) || Object.keys(data).some(key => !REQUEST_KEYS.has(key)) ||
      typeof data.idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(data.idempotencyKey)) invalid();
  const chatId = data.chatId || "group";
  if (data.sender !== "user" || data.triggerTurn !== false || !ROOMS.has(chatId)) {
    throw new MessageReceiptError("CHAT_IDEMPOTENCY_SCOPE_UNSUPPORTED");
  }
  const type = data.type || "chat";
  const senderName = data.senderName === undefined ? "Bayu" : data.senderName;
  const duration = data.duration || (type === "voice_note" ? "00:05" : null);
  const quoted = data.quoted || null;
  if (!boundedText(data.text, 65536) || !boundedText(senderName, 256) ||
      !["chat", "voice_note"].includes(type) ||
      (duration !== null && !boundedText(duration, 32)) ||
      (quoted !== null && (!object(quoted) || Buffer.byteLength(canonical(quoted)) > 8192))) invalid();
  const fields = { chatId, sender: "user", senderName, text: data.text, type, duration, quoted };
  return { fields, keyHash: digest(["chat-append-v1", chatId, "user", data.idempotencyKey]), payloadHash: digest(fields) };
}
function emptyReceipts() { return { schemaVersion: 1, entries: [] }; }
function validateMessageReceipts(value) {
  // Legacy snapshots lack this optional additive field.
  if (value === undefined) return;
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.entries) || value.entries.length > MAX_RECEIPTS ||
      Object.keys(value).some(k => !["schemaVersion", "entries"].includes(k))) throw new Error("Invalid receipt state");
  const seen = new Set();
  for (const entry of value.entries) {
    if (!object(entry) || Object.keys(entry).length !== 5 ||
        typeof entry.keyHash !== "string" || typeof entry.payloadHash !== "string" ||
        !HASH.test(entry.keyHash) || !HASH.test(entry.payloadHash) ||
        !ROOMS.has(entry.chatId) || entry.sender !== "user" ||
        !boundedText(entry.messageId, 128) || seen.has(entry.keyHash)) throw new Error("Invalid receipt entry");
    seen.add(entry.keyHash);
  }
}
function findMessageReplay(receipts, chats, request) {
  const entry = receipts.entries.find(e => e.keyHash === request.keyHash);
  if (!entry) return null;
  if (entry.payloadHash !== request.payloadHash || entry.chatId !== request.fields.chatId || entry.sender !== request.fields.sender) {
    throw new MessageReceiptError("CHAT_IDEMPOTENCY_CONFLICT");
  }
  const messages = chats[entry.chatId];
  const message = Array.isArray(messages) ? messages.find(m => m && m.id === entry.messageId) : null;
  if (!message) throw new MessageReceiptError("CHAT_IDEMPOTENCY_MESSAGE_GONE");
  const fields = { chatId: message.chatId, sender: message.sender, senderName: message.senderName,
    text: message.text, type: message.type, duration: message.duration, quoted: message.quoted };
  let hash;
  try { hash = digest(fields); } catch { hash = null; }
  if (hash !== entry.payloadHash) throw new MessageReceiptError("CHAT_IDEMPOTENCY_MESSAGE_CHANGED");
  return structuredClone(message);
}
function appendMessageReceipt(receipts, request, messageId) {
  if (receipts.entries.length >= MAX_RECEIPTS) throw new MessageReceiptError("CHAT_IDEMPOTENCY_CAPACITY");
  if (receipts.entries.some(e => e.keyHash === request.keyHash)) throw new MessageReceiptError("CHAT_IDEMPOTENCY_CONFLICT");
  receipts.entries.push({ keyHash: request.keyHash, payloadHash: request.payloadHash, chatId: request.fields.chatId,
    sender: request.fields.sender, messageId });
}
module.exports = { MAX_RECEIPTS, MessageReceiptError, prepareMessageRequest, emptyReceipts,
  validateMessageReceipts, findMessageReplay, appendMessageReceipt };
