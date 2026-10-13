#!/usr/bin/env python3
"""Synthetic chat restart gate for an explicitly isolated loopback test server.

The proof file is private test state, never a CI artifact. This exercises the
existing internal message endpoint with triggerTurn=false; no provider is used.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

ROOMS = ("group", "direct_budi", "direct_rian")
MAX_RESPONSE = 2 * 1024 * 1024


class ProbeFailure(Exception):
    """Deliberately payload-free diagnostic safe for CI logs."""


def loopback_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1"
            or parsed.username is not None or parsed.password is not None
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        raise ProbeFailure("Persistence probe requires a plain loopback base URL")
    try:
        port = parsed.port
    except ValueError as error:
        raise ProbeFailure("Invalid loopback port") from error
    if port is None or not 1 <= port <= 65535:
        raise ProbeFailure("Explicit loopback port required")
    return f"http://127.0.0.1:{port}"


def request_json(base: str, path: str, body: dict[str, Any] | None = None) -> Any:
    encoded = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(base + path, data=encoded,
                                    headers={"Content-Type": "application/json"})
    # Do not consult HTTP_PROXY, and never follow a redirect away from localhost.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args: Any, **kwargs: Any) -> None:
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=5) as response:
            raw = response.read(MAX_RESPONSE + 1)
            if response.status != 200 or len(raw) > MAX_RESPONSE:
                raise ProbeFailure("Unexpected HTTP response status or size")
        return json.loads(raw)
    except (OSError, ValueError, urllib.error.URLError) as error:
        # HTTP error responses and messages could contain chat text or secrets.
        raise ProbeFailure("Chat persistence HTTP request failed") from error


def validate_snapshot(proof: dict[str, Any], snapshot: dict[str, Any]) -> None:
    chats = snapshot.get("chats")
    if not isinstance(chats, dict) or proof.get("schemaVersion") != 1:
        raise ProbeFailure("Invalid chat persistence proof or response shape")
    for room in ROOMS:
        expected = proof["expectedRooms"][room]
        actual = chats.get(room)
        if not isinstance(actual, list) or actual != expected:
            raise ProbeFailure("Chat snapshot changed, disappeared, duplicated or moved")
    for room, original in proof["untouchedRooms"].items():
        if chats.get(room) != original:
            raise ProbeFailure("Unrelated chat room changed")
    if set(chats) != set(proof["expectedRooms"]) | set(proof["untouchedRooms"]):
        raise ProbeFailure("Unexpected room appeared or disappeared")


def seed(base: str, proof_path: Path) -> int:
    if proof_path.exists():
        raise ProbeFailure("Refusing to overwrite an existing proof")
    before = request_json(base, "/api/chats")
    chats = before.get("chats") if isinstance(before, dict) else None
    if not isinstance(chats, dict) or any(not isinstance(chats.get(room), list) for room in ROOMS):
        raise ProbeFailure("Legacy chat rooms are unavailable")
    # Avoid the backend's auto-compaction threshold in every tested room.
    if any(len(chats[room]) > 20 for room in ROOMS):
        raise ProbeFailure("Probe refuses a nontrivial existing conversation")
    nonce = uuid.uuid4().hex
    expected = {room: list(chats[room]) for room in ROOMS}
    plan = (
        ("group", "Unicode fixture: Bahasa Indonesia, 日本語, café, 👩🏽‍💻\nSecond line.", "chat", None),
        ("direct_budi", "Budi-only synthetic fixture " + nonce, "chat", None),
        ("direct_rian", "Rian-only synthetic fixture " + nonce, "chat", None),
        ("group", "Synthetic quoted reply " + nonce, "chat", None),
        ("direct_budi", "Synthetic voice-note metadata " + nonce, "voice_note", "00:07"),
    )
    first = None
    for room, text, kind, duration in plan:
        quoted = {"id": first["id"], "text": first["text"], "senderName": first["senderName"]} if first and room == "group" else None
        payload = {"chatId": room, "sender": "user", "senderName": "QA synthetic owner",
                   "text": text, "type": kind, "duration": duration,
                   "quoted": quoted, "triggerTurn": False}
        result = request_json(base, "/api/internal/chat-message", payload)
        message = result.get("message") if isinstance(result, dict) else None
        if (not isinstance(result, dict) or result.get("success") is not True or not isinstance(message, dict)
                or not isinstance(message.get("id"), str) or not message["id"]
                or message.get("chatId") != room or message.get("text") != text
                or message.get("quoted") != quoted or message.get("type") != kind
                or message.get("duration") != duration):
            raise ProbeFailure("Message acknowledgement does not match the fixture")
        expected[room].append(message)
        if first is None:
            first = message
    proof = {"schemaVersion": 1, "fixtureCount": len(plan), "expectedRooms": expected,
             "untouchedRooms": {room: content for room, content in chats.items() if room not in ROOMS}}
    validate_snapshot(proof, request_json(base, "/api/chats"))
    fd = os.open(proof_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(proof, output, ensure_ascii=False)
    return len(plan)


def verify(base: str, proof_path: Path) -> int:
    try:
        proof = json.loads(proof_path.read_text(encoding="utf-8"))
        validate_snapshot(proof, request_json(base, "/api/chats"))
        return int(proof["fixtureCount"])
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise ProbeFailure("Cannot validate private chat persistence proof") from error


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("seed", "verify"))
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--proof", type=Path, required=True)
    parser.add_argument("--isolated-test", action="store_true")
    args = parser.parse_args()
    try:
        if not args.isolated_test:
            raise ProbeFailure("Explicit isolated-test opt-in required")
        base = loopback_url(args.base_url)
        count = seed(base, args.proof) if args.action == "seed" else verify(base, args.proof)
        marker = "CP16_CHAT_PERSISTENCE_SEEDED" if args.action == "seed" else "CP16_CHAT_PERSISTENCE_PASS"
        print(f"{marker} count={count}")
        return 0
    except ProbeFailure as error:
        print(f"CP16_CHAT_PERSISTENCE_FAILURE: {error}", file=sys.stderr)
        return 60


if __name__ == "__main__":
    raise SystemExit(main())
