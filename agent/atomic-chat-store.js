"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { validateMessageReceipts } = require("./message-receipts");

const MESSAGES = Object.freeze({
  CHAT_STORAGE_RECONCILIATION_REQUIRED: "Penyimpanan menunggu rekonsiliasi setelah kegagalan sinkronisasi. Muat ulang sebelum perubahan berikutnya.",
  CHAT_STORAGE_UNREADABLE: "Riwayat chat tidak dapat dibaca. File asli dipertahankan; penulisan dinonaktifkan.",
  CHAT_STORAGE_WRITE_FAILED: "Penyimpanan chat gagal. Perubahan ini belum disimpan; data sebelumnya dipertahankan.",
  CHAT_STORAGE_COMMIT_UNCERTAIN: "File chat sudah diganti, tetapi sinkronisasi direktori gagal. Muat ulang untuk memeriksa hasil; jangan kirim ulang otomatis."
});
const SAFE_REASONS = new Set(["ENOSPC", "EDQUOT", "EIO", "EACCES", "EPERM", "EROFS", "ENOENT", "EEXIST", "ELOOP", "EINVAL", "ENOTSUP", "ENOTDIR", "EMFILE", "ENFILE"]);

class ChatStorageError extends Error {
  constructor(code, { committed = false, reason = null } = {}) {
    super(MESSAGES[code]);
    this.name = "ChatStorageError";
    this.code = code;
    this.committed = committed;
    // Never retain the original exception: its message/path may disclose data.
    this.reason = SAFE_REASONS.has(reason) ? reason : "STORAGE_IO";
    this.retryable = code === "CHAT_STORAGE_WRITE_FAILED" && !committed;
    this.requiresReconciliation = committed || code === "CHAT_STORAGE_RECONCILIATION_REQUIRED";
    this.statusCode = !committed && ["ENOSPC", "EDQUOT"].includes(reason) ? 507 : 503;
  }
  toPublic() {
    return { code: this.code, error: this.message, reason: this.reason,
      committed: this.committed, retryable: this.retryable,
      requiresReconciliation: this.requiresReconciliation };
  }
}

function validateChatRecord(data) {
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!object(data)) throw new Error("Invalid record");
  if (data.chats !== undefined && (!object(data.chats) || Object.values(data.chats).some(x => !Array.isArray(x)))) {
    throw new Error("Invalid rooms");
  }
  for (const key of ["statuses", "calls", "internalPeer"]) {
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error("Invalid collection");
  }
  if (data.contextMemory !== undefined && (!object(data.contextMemory) || Object.values(data.contextMemory).some(x => typeof x !== "string"))) {
    throw new Error("Invalid memory");
  }
  validateMessageReceipts(data.messageReceipts);
  return data;
}

/**
 * Single-owner snapshot store for the existing Node backend, on a local filesystem.
 * Write privately in the same directory, flush, close, rename, then flush directory.
 * No direct-write fallback, no implicit retries, and no recovery from orphan temps.
 * Atomic replacement is not a multiprocess lock or a physical power-loss test.
 * The injectable fs adapter is constructor-only for isolated QA, never an HTTP knob.
 */
class AtomicChatStore {
  constructor(filename, { io = fs } = {}) {
    if (typeof filename !== "string" || !filename) throw new TypeError("Chat storage filename required");
    this.file = path.resolve(filename);
    this.dir = path.dirname(this.file);
    this.io = io;
  }
  checkTarget() {
    try {
      const stat = this.io.lstatSync(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
        throw Object.assign(new Error("Unsafe file"), { code: "ELOOP" });
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  read() {
    let fd;
    try {
      this.checkTarget();
      try {
        fd = this.io.openSync(this.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
      const stat = this.io.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) throw Object.assign(new Error("Unsafe file"), { code: "ELOOP" });
      return validateChatRecord(JSON.parse(this.io.readFileSync(fd, "utf8")));
    } catch (error) {
      throw new ChatStorageError("CHAT_STORAGE_UNREADABLE", { reason: error.code });
    } finally {
      if (fd !== undefined) { try { this.io.closeSync(fd); } catch {} }
    }
  }
  writeSerialized(serialized) {
    let fd;
    let dirFd;
    let temporary;
    let ownsTemporary = false;
    let committed = false;
    try {
      // Validate before touching even a temporary file; never truncate the original.
      if (typeof serialized !== "string") throw new TypeError("Serialized record required");
      validateChatRecord(JSON.parse(serialized));
      const directory = this.io.lstatSync(this.dir);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw Object.assign(new Error("Unsafe directory"), { code: "ELOOP" });
      this.checkTarget();
      dirFd = this.io.openSync(this.dir, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) | (fs.constants.O_NOFOLLOW || 0));
      if (!this.io.fstatSync(dirFd).isDirectory()) throw Object.assign(new Error("Not directory"), { code: "ENOTDIR" });
      temporary = path.join(this.dir, "." + path.basename(this.file) + ".atomic-" + process.pid + "-" + crypto.randomBytes(12).toString("hex") + ".tmp");
      fd = this.io.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0), 0o600);
      ownsTemporary = true;
      const bytes = Buffer.from(serialized, "utf8");
      let offset = 0;
      while (offset < bytes.length) {
        const written = this.io.writeSync(fd, bytes, offset, bytes.length - offset, null);
        if (!Number.isInteger(written) || written <= 0 || written > bytes.length - offset) {
          throw Object.assign(new Error("No write progress"), { code: "EIO" });
        }
        offset += written;
      }
      this.io.fsyncSync(fd);
      const completedFd = fd;
      fd = undefined; // close may fail after releasing it; never retry/reuse the fd.
      this.io.closeSync(completedFd);
      this.checkTarget();
      this.io.renameSync(temporary, this.file);
      committed = true;
      ownsTemporary = false;
      // After rename, a sync failure cannot honestly be described as "not saved".
      this.io.fsyncSync(dirFd);
      return { committed: true, directorySynced: true };
    } catch (error) {
      throw new ChatStorageError(committed ? "CHAT_STORAGE_COMMIT_UNCERTAIN" : "CHAT_STORAGE_WRITE_FAILED", {
        committed, reason: error.code
      });
    } finally {
      if (fd !== undefined) { try { this.io.closeSync(fd); } catch {} }
      if (ownsTemporary) { try { this.io.unlinkSync(temporary); } catch {} }
      if (dirFd !== undefined) { try { this.io.closeSync(dirFd); } catch {} }
    }
  }
}

module.exports = { AtomicChatStore, ChatStorageError, validateChatRecord };
