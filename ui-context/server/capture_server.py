#!/usr/bin/env python3
"""Minimal stdlib-only HTTP server for the ui-context extension.
Listens on 127.0.0.1:8765, accepts POST /capture with JSON body,
saves the JSON (minus screenshot) to <captures>/<ts>.json and the
screenshot (if present, as a data URL) to <captures>/<ts>.png.

Captures go to a single global directory so the server does not need to
know which project a capture belongs to:
  ~/.local/share/ui-context/captures
Override with the UI_CONTEXT_CAPTURES_DIR environment variable.
"""
import base64
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEFAULT_CAPTURES_DIR = Path.home() / ".local" / "share" / "ui-context" / "captures"
CAPTURES_DIR = Path(
    os.environ.get("UI_CONTEXT_CAPTURES_DIR") or DEFAULT_CAPTURES_DIR
).expanduser()
CAPTURES_DIR.mkdir(parents=True, exist_ok=True)


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/ping":
            self.send_response(200)
            self._cors()
            self.end_headers()
            self.wfile.write(b"ok")
            return
        self.send_response(404)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != "/capture":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            self.send_response(400)
            self._cors()
            self.end_headers()
            self.wfile.write(f"bad json: {e}".encode())
            return

        ts = time.strftime("%Y%m%dT%H%M%S") + f"-{int(time.time() * 1000) % 1000:03d}"
        screenshot = data.pop("screenshotDataUrl", None)
        json_path = CAPTURES_DIR / f"{ts}.json"
        json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

        png_saved = False
        if screenshot and isinstance(screenshot, str) and screenshot.startswith("data:image/png;base64,"):
            b64 = screenshot.split(",", 1)[1]
            png_path = CAPTURES_DIR / f"{ts}.png"
            png_path.write_bytes(base64.b64decode(b64))
            png_saved = True

        print(f"[capture_server] saved {json_path.name} (screenshot={'yes' if png_saved else 'no'})")

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "id": ts, "screenshot": png_saved}).encode())

    def log_message(self, fmt, *args):
        # Keep default stderr logging; comment out to silence.
        pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("[capture_server] listening on http://127.0.0.1:8765")
    print(f"[capture_server] captures dir: {CAPTURES_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
