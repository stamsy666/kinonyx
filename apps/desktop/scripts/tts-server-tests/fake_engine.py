"""Stand-in for omnivoice.cpp's tts-server (with the dubbing patch), for tests without a GPU.

Same endpoints and fields. Speech is a tone whose length follows the patched server's rule:
natural length (chars / speaking rate of the reference) when it fits `max_duration`, else
faster by at most `max_speedup`, never shorter than the slot; `duration` forces a length.
Every request body is recorded so tests can check what the client sent.

Run standalone:  python fake_engine.py --port 8080
"""

import argparse
import base64
import io
import json
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

SR = 24000
CHARS_PER_S = 14.0  # default speaking rate when a voice has no reference


def wav_bytes(seconds):
    n = max(1, int(seconds * SR))
    t = np.arange(n) / SR
    s = (0.2 * np.sin(2 * np.pi * 220 * t) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(s.tobytes())
    return buf.getvalue()


def make_server(port=0):
    state = {"voices": {}, "calls": []}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, ctype="application/json"):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                return self.send(200, b'{"status":"ok"}')
            if self.path == "/v1/audio/voices":
                return self.send(200, json.dumps({"data": [{"name": n} for n in state["voices"]]}).encode())
            self.send(404, b"{}")

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            state["calls"].append((self.path, body))
            if self.path == "/v1/audio/voices":
                if not body.get("ref_text"):
                    return self.send(400, b'{"error":"ref_text"}')
                raw = base64.b64decode(body["wav_b64"])
                with wave.open(io.BytesIO(raw), "rb") as w:
                    secs = w.getnframes() / w.getframerate()
                state["voices"][body["name"]] = {"seconds": secs, "ref_text": body["ref_text"]}
                return self.send(200, json.dumps({"name": body["name"], "status": "registered"}).encode())
            if self.path == "/v1/audio/speech":
                voice = body.get("voice", "")
                if voice and voice not in state["voices"]:
                    return self.send(400, json.dumps({"error": f"unknown voice '{voice}'"}).encode())
                rate = CHARS_PER_S
                if voice:
                    v = state["voices"][voice]
                    rate = max(1.0, len(v["ref_text"]) / v["seconds"])
                natural = len(body["input"]) / rate
                if body.get("duration", 0) > 0:
                    secs = body["duration"]
                elif body.get("max_duration", 0) > 0:
                    slot, speed = body["max_duration"], max(1.0, body.get("max_speedup", 1.0))
                    secs = natural if natural <= slot else max(slot, natural / speed)
                else:
                    secs = natural
                return self.send(200, wav_bytes(secs), "audio/wav")
            self.send(404, b"{}")

    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, state


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--model")
    p.add_argument("--codec")
    p.add_argument("--host")
    a = p.parse_args()
    srv, _ = make_server(a.port)
    threading.Event().wait()
