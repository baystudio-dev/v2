#!/usr/bin/env python3
"""Exercise the real local HTTP gate in disposable desktop/Android CI storage.

No model work, secrets, or transcripts are printed or uploaded. Rejected write
fixtures use triggerTurn=false even if an older server unexpectedly accepts one.
"""
from __future__ import annotations
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request


class BoundaryFailure(Exception):
    pass


def base_url(value: str) -> str:
    try:
        url = urllib.parse.urlsplit(value)
        if (url.scheme != "http" or url.hostname != "127.0.0.1" or url.username is not None or url.password is not None
                or url.path not in ("", "/") or url.query or url.fragment or url.port is None or not 1 <= url.port <= 65535):
            raise ValueError("local target required")
        return f"http://127.0.0.1:{url.port}"
    except ValueError as error:
        raise BoundaryFailure("Explicit loopback URL required") from error


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(base: str, route: str, method: str = "GET", headers: dict | None = None, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(base + route, method=method, headers=headers or {}, data=data)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        try:
            response = opener.open(req, timeout=4)
        except urllib.error.HTTPError as response_error:
            response = response_error
        with response:
            raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise BoundaryFailure("Unexpected response size")
            payload = json.loads(raw) if raw else None
            return response.code, response.headers, payload
    except (OSError, ValueError, urllib.error.URLError) as error:
        raise BoundaryFailure("Cannot complete local HTTP boundary check") from error


def verify(base: str) -> int:
    status, headers, before = request(base, "/api/chats")
    if status != 200 or not isinstance(before, dict) or not isinstance(before.get("chats"), dict):
        raise BoundaryFailure("Baseline history unavailable")
    own_headers = {"Origin": base, "Referer": base + "/", "Sec-Fetch-Site": "same-origin"}
    status, headers, same = request(base, "/api/chats", headers=own_headers)
    if status != 200 or same != before or headers.get("Access-Control-Allow-Origin") != base:
        raise BoundaryFailure("Same-origin client lost access")
    if headers.get("X-Content-Type-Options") != "nosniff" or headers.get("Cache-Control") != "no-store":
        raise BoundaryFailure("Sensitive response headers missing")
    fixture = {"text": "Synthetic boundary fixture must remain absent", "sender": "user", "chatId": "group", "triggerTurn": False}
    cases = [
        ("GET", "/api/chats", {"Host": "rebound.invalid:3000", "Origin": "http://rebound.invalid:3000"}, None, 403),
        ("GET", "/api/chats", {"Origin": "https://outside.invalid"}, None, 403),
        ("GET", "/api/chats", {"Origin": "null"}, None, 403),
        ("GET", "/api/chats", {"Sec-Fetch-Site": "cross-site"}, None, 403),
        ("GET", "/api/chats", {"Sec-Fetch-Site": "same-site"}, None, 403),
        ("GET", "/api/chats", {"Referer": "https://outside.invalid/private"}, None, 403),
        ("GET", "/api/events", {"Origin": "https://outside.invalid"}, None, 403),
        ("OPTIONS", "/api/internal/chat-message", {"Origin": "https://outside.invalid", "Access-Control-Request-Method": "POST"}, None, 403),
        ("POST", "/api/internal/chat-message", {"Content-Type": "text/plain"}, fixture, 415),
        ("POST", "/api/internal/chat-message", {"Content-Type": "application/x-www-form-urlencoded"}, fixture, 415),
        ("POST", "/api/internal/chat-message", {"Content-Type": "application/json", "Origin": "null"}, fixture, 403),
        ("GET", "/api/chats", {"Host": "rebound.invalid:3000", "X-Forwarded-Host": urllib.parse.urlsplit(base).netloc}, None, 403),
        ("POST", "/api/events", {"Content-Type": "application/json"}, {}, 405),
    ]
    for method, route, sent, body, expected in cases:
        status, headers, error = request(base, route, method, sent, body)
        if status != expected or not isinstance(error, dict) or not str(error.get("code", "")).startswith("LOCAL_HTTP_"):
            raise BoundaryFailure("A denied HTTP context reached an unexpected handler")
        if headers.get("Access-Control-Allow-Origin") is not None:
            raise BoundaryFailure("Rejected response grants CORS access")
        if any(word in json.dumps(error) for word in ["rebound.invalid", "outside.invalid", "Synthetic boundary fixture"]):
            raise BoundaryFailure("Rejection reflected sensitive request details")
    status, headers, _ = request(base, "/api/internal/chat-message", "OPTIONS", {**own_headers,
        "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type"})
    if status != 204 or headers.get("Access-Control-Allow-Origin") != base:
        raise BoundaryFailure("Same-origin JSON preflight rejected")
    status, _, after = request(base, "/api/chats")
    if status != 200 or after != before:
        raise BoundaryFailure("Rejected request changed history")
    return len(cases)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--isolated-test", action="store_true")
    args = parser.parse_args()
    try:
        if not args.isolated_test:
            raise BoundaryFailure("Explicit isolated-test opt-in required")
        count = verify(base_url(args.base_url))
        print(f"CP16_LOCAL_HTTP_BOUNDARY_PASS rejected={count} same_origin=1 native=1")
        return 0
    except BoundaryFailure as error:
        print(f"CP16_LOCAL_HTTP_BOUNDARY_FAILURE: {error}", file=sys.stderr)
        return 61


if __name__ == "__main__":
    raise SystemExit(main())
