#!/usr/bin/env python3
"""Small LAN relay for the Cam Virtual local preview.

The relay keeps sessions and only the newest JPEG frame in memory. It is an MVP
transport for a trusted LAN, not the later Internet/WebRTC media service.
"""

from __future__ import annotations

import json
import ipaddress
import os
import re
import secrets
import socket
import subprocess
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse


ROOT = Path(__file__).resolve().parent
STUDIO_URL = "https://campoc.onrender.com/?transport=usb"
MAX_FRAME_BYTES = 8 * 1024 * 1024
MAX_SESSION_SECONDS = 2 * 60 * 60
PAIR_CODE_SECONDS = 5 * 60
DISCOVERY_PORT = 4174
PAIR_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
LOCK = threading.Lock()
SESSIONS: dict[str, dict] = {}
CLAIM_ATTEMPTS: dict[str, list[float]] = {}


def new_pair_code() -> str:
    while True:
        raw = "".join(secrets.choice(PAIR_CODE_ALPHABET) for _ in range(8))
        code = f"{raw[:4]}-{raw[4:]}"
        if all(session.get("pairCode") != code for session in SESSIONS.values()):
            return code


def find_pairing_session(code: str) -> tuple[str, dict] | None:
    now = int(time.time())
    for room, session in SESSIONS.items():
        if (
            session.get("pairCode") == code
            and session.get("pairExpires", 0) > now
            and not session.get("pairClaimed", False)
            and session["expires"] > now
        ):
            return room, session
    return None


def discovery_loop(server_port: int) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", DISCOVERY_PORT))
    while True:
        try:
            payload, address = sock.recvfrom(256)
            text = payload.decode("ascii", errors="ignore").strip().upper()
            match = re.fullmatch(r"CAMVIRTUAL_DISCOVER\s+([A-Z2-9]{4}-?[A-Z2-9]{4})", text)
            if not match:
                continue
            compact = match.group(1).replace("-", "")
            code = f"{compact[:4]}-{compact[4:]}"
            with LOCK:
                available = find_pairing_session(code) is not None
            if available:
                response = json.dumps({
                    "origin": f"http://{lan_ip()}:{server_port}",
                    "version": 1,
                }).encode("utf-8")
                sock.sendto(response, address)
        except OSError:
            time.sleep(0.2)


def lan_ip() -> str:
    try:
        output = subprocess.check_output(["ifconfig"], text=True, timeout=2)
        for block in re.split(r"\n(?=[A-Za-z0-9].*: flags=)", output):
            if not block.startswith(("en", "eth", "wlan")) or "status: active" not in block:
                continue
            match = re.search(r"\n\s*inet (\d+\.\d+\.\d+\.\d+)", block)
            if match and not match.group(1).startswith("127."):
                return match.group(1)
    except (OSError, subprocess.SubprocessError):
        pass
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


class Handler(SimpleHTTPRequestHandler):
    server_version = "CamVirtualRelay/0.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, message: str, *args) -> None:
        # Never print query strings because they contain pairing tokens.
        clean_path = urlparse(self.path).path
        print(f"{self.client_address[0]} {self.command} {clean_path}")

    def end_headers(self) -> None:
        # Development clients must pick up transport fixes immediately instead of keeping a
        # stale relay loop in the browser cache.
        self.send_header("Cache-Control", "no-store")
        if self.path.startswith("/api/") and self.headers.get("Origin") == "https://campoc.onrender.com":
            self.send_header("Access-Control-Allow-Origin", "https://campoc.onrender.com")
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        if not urlparse(self.path).path.startswith("/api/"):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self, limit: int) -> bytes | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length <= 0 or length > limit:
            return None
        return self.rfile.read(length)

    def authenticated_session(self, room: str, token: str | None) -> dict | None:
        with LOCK:
            session = SESSIONS.get(room)
            if not session or session["expires"] <= int(time.time()):
                SESSIONS.pop(room, None)
                return None
            if not token or token != session["token"]:
                return None
            return session

    def is_loopback_client(self) -> bool:
        try:
            return ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            return False

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/index.html"}:
            self.send_response(HTTPStatus.TEMPORARY_REDIRECT)
            self.send_header("Location", STUDIO_URL)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if parsed.path == "/api/info":
            self.send_json(HTTPStatus.OK, {
                "receiverOrigin": f"http://{lan_ip()}:{self.server.server_port}",
                "transport": "lan-jpeg-v1",
            })
            return

        if parsed.path == "/api/usb/session":
            # This endpoint transfers the receiver token only through localhost.
            # With `adb reverse tcp:4173 tcp:4173`, Android reaches this route as
            # a loopback client, while LAN peers cannot claim a session without
            # the normal one-time pairing code.
            if not self.is_loopback_client():
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "usb_only"})
                return
            now = int(time.time())
            with LOCK:
                active = [
                    (room, session)
                    for room, session in SESSIONS.items()
                    if session["expires"] > now
                ]
                latest = max(
                    active,
                    key=lambda item: item[1].get("registeredAt", 0),
                    default=None,
                )
                if latest:
                    room, session = latest
                    uri = "camvirtual://pair?" + urlencode({
                        "v": "1",
                        "room": room,
                        "token": session["token"],
                        "expires": str(session["expires"]),
                        "origin": f"http://127.0.0.1:{self.server.server_port}",
                    })
            if not latest:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "no_active_session"})
            else:
                self.send_json(HTTPStatus.OK, {"uri": uri, "transport": "usb-adb-reverse-v1"})
            return

        parts = parsed.path.strip("/").split("/")
        if len(parts) == 4 and parts[:2] == ["api", "rooms"]:
            room, action = parts[2], parts[3]
            query = parse_qs(parsed.query)
            token = query.get("token", [None])[0]
            session = self.authenticated_session(room, token)
            if not session:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "invalid_session"})
                return
            if action == "status":
                with LOCK:
                    frame = session.get("frame")
                    published_at = session.get("publishedAt", 0)
                self.send_json(HTTPStatus.OK, {
                    "room": room,
                    "connected": bool(session.get("receiverConnected")),
                    "hasFrame": frame is not None,
                    "frameAgeMs": max(0, int((time.time() - published_at) * 1000)) if frame else None,
                })
                return
            if action == "frame":
                after = int(query.get("after", ["-1"])[0])
                with LOCK:
                    session["receiverConnected"] = True
                    frame = session.get("frame")
                    sequence = session.get("sequence", 0)
                if frame is None or sequence <= after:
                    self.send_response(HTTPStatus.NO_CONTENT)
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    return
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(frame)))
                self.send_header("X-CamVirtual-Sequence", str(sequence))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(frame)
                return

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        close_match = re.fullmatch(r"/api/rooms/([A-HJ-NP-Z2-9]{6})/close", parsed.path)
        if close_match:
            body = self.read_body(2048)
            try:
                value = json.loads(body or b"")
                token = value.get("token")
            except (ValueError, TypeError):
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_body"})
                return
            room = close_match.group(1)
            session = self.authenticated_session(room, token)
            if not session:
                self.send_json(HTTPStatus.OK, {"removed": False})
                return
            with LOCK:
                kept = bool(session.get("receiverConnected"))
                if not kept and SESSIONS.get(room) is session:
                    del SESSIONS[room]
            self.send_json(HTTPStatus.OK, {"kept": kept, "removed": not kept})
            return
        if parsed.path == "/api/sessions":
            body = self.read_body(16 * 1024)
            if body is None:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_body"})
                return
            try:
                value = json.loads(body)
                room = str(value["room"])
                token = str(value["token"])
                expires = int(value["expires"])
                if not re.fullmatch(r"[A-HJ-NP-Z2-9]{6}", room) or not 22 <= len(token) <= 128:
                    raise ValueError()
                if expires <= int(time.time()) or expires > int(time.time()) + MAX_SESSION_SECONDS:
                    raise ValueError()
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_session"})
                return
            with LOCK:
                previous = SESSIONS.get(room)
                if previous and previous.get("token") != token and previous.get("expires", 0) > int(time.time()):
                    self.send_json(HTTPStatus.CONFLICT, {"error": "room_exists"})
                    return
                if previous and previous.get("token") == token:
                    session = previous
                    session["expires"] = expires
                    session["registeredAt"] = time.time()
                else:
                    session = {
                        "token": token,
                        "expires": expires,
                        "frame": None,
                        "sequence": 0,
                        "publishedAt": 0,
                        "registeredAt": time.time(),
                    }
                    SESSIONS[room] = session
                now = int(time.time())
                if (
                    not session.get("pairCode")
                    or session.get("pairExpires", 0) <= now
                    or session.get("pairClaimed", False)
                ):
                    session["pairCode"] = new_pair_code()
                    session["pairExpires"] = min(expires, now + PAIR_CODE_SECONDS)
                    session["pairClaimed"] = False
                pair_code = session["pairCode"]
                pair_expires = session["pairExpires"]
            self.send_json(HTTPStatus.CREATED, {
                "room": room,
                "receiverOrigin": f"http://{lan_ip()}:{self.server.server_port}",
                "pairCode": pair_code,
                "pairExpires": pair_expires,
            })
            return

        if parsed.path == "/api/pair/claim":
            body = self.read_body(2 * 1024)
            if body is None:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_code"})
                return
            try:
                value = json.loads(body)
                compact = re.sub(r"[^A-Z2-9]", "", str(value["code"]).upper())
                if not re.fullmatch(r"[A-HJ-NP-Z2-9]{8}", compact):
                    raise ValueError()
                code = f"{compact[:4]}-{compact[4:]}"
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_code"})
                return

            client = self.client_address[0]
            now = time.time()
            with LOCK:
                recent = [attempt for attempt in CLAIM_ATTEMPTS.get(client, []) if now - attempt < 60]
                if len(recent) >= 8:
                    CLAIM_ATTEMPTS[client] = recent
                    match = None
                    rate_limited = True
                else:
                    recent.append(now)
                    CLAIM_ATTEMPTS[client] = recent
                    match = find_pairing_session(code)
                    rate_limited = False
                    if match:
                        room, session = match
                        session["pairClaimed"] = True
                        origin = f"http://{lan_ip()}:{self.server.server_port}"
                        uri = "camvirtual://pair?" + urlencode({
                            "v": "1",
                            "room": room,
                            "token": session["token"],
                            "expires": str(session["expires"]),
                            "origin": origin,
                        })
            if rate_limited:
                self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "too_many_attempts"})
            elif not match:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "invalid_or_expired_code"})
            else:
                self.send_json(HTTPStatus.OK, {"uri": uri})
            return

        parts = parsed.path.strip("/").split("/")
        if len(parts) == 4 and parts[:2] == ["api", "rooms"] and parts[3] == "frame":
            room = parts[2]
            token = parse_qs(parsed.query).get("token", [None])[0]
            session = self.authenticated_session(room, token)
            if not session:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "invalid_session"})
                return
            if self.headers.get_content_type() != "image/jpeg":
                self.send_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "jpeg_required"})
                return
            frame = self.read_body(MAX_FRAME_BYTES)
            if frame is None:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_frame"})
                return
            with LOCK:
                session["frame"] = frame
                session["sequence"] += 1
                session["publishedAt"] = time.time()
                sequence = session["sequence"]
            self.send_json(HTTPStatus.ACCEPTED, {"sequence": sequence})
            return

        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["api", "rooms"]:
            room = parts[2]
            token = parse_qs(parsed.query).get("token", [None])[0]
            if not self.authenticated_session(room, token):
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "invalid_session"})
                return
            with LOCK:
                SESSIONS.pop(room, None)
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})


if __name__ == "__main__":
    bind_host = os.environ.get("CAM_STUDIO_BIND", "0.0.0.0")
    server = ThreadingHTTPServer((bind_host, 4173), Handler)
    if bind_host not in {"127.0.0.1", "::1", "localhost"}:
        threading.Thread(target=discovery_loop, args=(server.server_port,), daemon=True).start()
    print(f"Cam Virtual Studio UI: {STUDIO_URL}")
    print(f"USB/LAN relay API: http://127.0.0.1:{server.server_port}/api/info")
    if bind_host in {"127.0.0.1", "::1", "localhost"}:
        print("USB-only mode: relay chỉ lắng nghe trên máy tính này")
    else:
        print(f"Điện thoại sẽ nhận qua: http://{lan_ip()}:{server.server_port}")
        print(f"LAN discovery UDP: {DISCOVERY_PORT}")
    server.serve_forever()
