"""KINONYX voice-over server: speaks each translated line in the voice of whoever said it.

Same HTTP contract as the PyTorch version (the app does not change):

    POST /speak  {"text", "lang", "pcm" (base64 s16le mono), "rate", "ref_text", "slot", "lead"?}
      -> audio/wav (s16le mono, 24 kHz); X-Gen-Ms, X-Speaker headers
    POST /reset  forget the voices of the previous channel
    GET  /health

What changed: synthesis runs in omnivoice.cpp (GGML, Q8_0) instead of PyTorch. Same model, the
port matches the PyTorch reference (audio cosine > 0.9999), but it needs well under half the
video memory and no PyTorch/CUDA wheels at all (the voice runtime shrinks from ~3.3 GB of pip
downloads to numpy + sherpa-onnx). This script keeps what it did before — the speaker bank,
reference choice, fitting a line into the time the original took — and drives omnivoice.cpp's
`tts-server` (patched with duration/steps fields, see scripts/omnivoice-cpp-dubbing.patch) over
HTTP. The app starts that engine itself (engines.rs) and passes its address as --engine-url.

The line's own source audio is the voice reference whenever it is long enough (timbre and
intonation of that very utterance). Short lines ("Yes.", "What?") make poor references, so
every speaker heard so far keeps a bank entry — recognised by a voiceprint — whose best clip
stands in for them.
"""

import argparse
import base64
import io
import json
import socket
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np

MIN_OWN_S = 3.0          # a line at least this long is its own voice reference
MIN_EMBED_S = 0.6        # shorter audio gives unreliable voiceprints
SAME_SPEAKER = 0.5       # cosine similarity above which two clips are the same person
MAX_SPEAKERS = 8
BEST_REF_S = (5.0, 10.0) # preferred length of a bank reference
MAX_REF_S = 12.0         # longer references only cost time
MAX_SPEEDUP = 1.35       # how much faster than natural a line may be spoken to fit its slot
OWN = "own"              # engine voice slot for "this line is its own reference"


# ---------------------------------------------------------------- audio helpers

def to_wav(samples, rate):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


def wav_seconds(data):
    with wave.open(io.BytesIO(data), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def trim_ref(audio, rate):
    """Keep at most MAX_REF_S of the middle: the encoder cost grows with the clip."""
    n = int(MAX_REF_S * rate)
    if len(audio) <= n:
        return audio
    start = (len(audio) - n) // 2
    return audio[start:start + n]


# ---------------------------------------------------------------- engine (omnivoice.cpp)

class Engine:
    """omnivoice.cpp tts-server, already running (the app starts it, engines.rs)."""

    def __init__(self, url, steps=16):
        self.steps = steps
        self.url = url.rstrip("/")
        self._wait_ready()

    def _wait_ready(self, timeout=120):
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                with urllib.request.urlopen(self.url + "/health", timeout=2) as r:
                    if r.status == 200:
                        return
            except (urllib.error.URLError, ConnectionError, socket.timeout):
                pass
            time.sleep(0.3)
        raise RuntimeError("omnivoice tts-server did not come up")

    def _post(self, path, body, timeout=120):
        req = urllib.request.Request(self.url + path, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"omnivoice {path}: {e.code} {e.read()[:300].decode(errors='replace')}") from None

    def register(self, name, audio, rate, ref_text):
        wav = to_wav(trim_ref(audio, rate), rate)
        self._post("/v1/audio/voices", {"name": name, "ref_text": ref_text, "wav_b64": base64.b64encode(wav).decode()})

    def speak(self, text, lang, voice, slot):
        body = {
            "input": text, "language": lang, "response_format": "wav", "seed": 42,
            "steps": self.steps, "max_duration": slot, "max_speedup": MAX_SPEEDUP,
        }
        if voice:
            body["voice"] = voice
        return self._post("/v1/audio/speech", body)



# ---------------------------------------------------------------- speaker bank

class Speaker:
    def __init__(self, emb, name, dur):
        self.emb, self.name, self.dur, self.n, self.used = emb, name, dur, 1, time.time()

    @staticmethod
    def ref_quality(dur):
        lo, hi = BEST_REF_S
        return -abs(min(max(dur, lo), hi) - dur) - (0 if dur >= MIN_OWN_S else 100)


class SherpaEmbedder:
    def __init__(self, model_path):
        import sherpa_onnx

        self.x = sherpa_onnx.SpeakerEmbeddingExtractor(
            sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=model_path, num_threads=2, provider="cpu")
        )

    def __call__(self, audio, rate):
        s = self.x.create_stream()
        s.accept_waveform(rate, audio)
        s.input_finished()
        e = np.array(self.x.compute(s), dtype=np.float32)
        return e / (np.linalg.norm(e) + 1e-9)


class Voice:
    def __init__(self, engine, embedder):
        self.engine = engine
        self.embed = embedder
        self.speakers: list[Speaker] = []
        self.free_names = [f"spk{i}" for i in range(MAX_SPEAKERS)]
        self.lock = threading.Lock()

    def reset(self):
        with self.lock:
            self.speakers.clear()
            self.free_names = [f"spk{i}" for i in range(MAX_SPEAKERS)]

    def pick(self, audio, rate, ref_text):
        """Engine voice name for this line (None = no reference), keeping the bank up to date."""
        dur = len(audio) / rate
        has_text = bool(ref_text.strip())
        emb = self.embed(audio, rate) if dur >= MIN_EMBED_S else None
        best, sim = None, -1.0
        if emb is not None:
            for sp in self.speakers:
                c = float(emb @ sp.emb)
                if c > sim:
                    best, sim = sp, c
        same = best is not None and sim >= SAME_SPEAKER

        if dur >= MIN_OWN_S and has_text:
            # The line is its own reference. When it also becomes a bank entry, the bank slot
            # holds exactly this clip, so it is encoded once and spoken from that slot.
            if same:
                best.emb = best.emb * best.n + emb
                best.n += 1
                best.emb /= np.linalg.norm(best.emb) + 1e-9
                best.used = time.time()
                if Speaker.ref_quality(dur) > Speaker.ref_quality(best.dur):
                    self.engine.register(best.name, audio, rate, ref_text)
                    best.dur = dur
                    return best.name, self.speakers.index(best)
                self.engine.register(OWN, audio, rate, ref_text)
                return OWN, self.speakers.index(best)
            if emb is not None:
                if len(self.speakers) >= MAX_SPEAKERS:
                    old = min(self.speakers, key=lambda s: s.used)
                    self.speakers.remove(old)
                    self.free_names.append(old.name)
                name = self.free_names.pop(0)
                self.engine.register(name, audio, rate, ref_text)
                self.speakers.append(Speaker(emb, name, dur))
                return name, len(self.speakers) - 1
            self.engine.register(OWN, audio, rate, ref_text)
            return OWN, -1
        if same or (best is not None and dur < 1.5):
            best.used = time.time()
            return best.name, self.speakers.index(best)
        if has_text and dur >= 1.0:
            self.engine.register(OWN, audio, rate, ref_text)
            return OWN, -1
        return None, -1

    def speak(self, text, lang, audio, rate, ref_text, slot):
        with self.lock:
            name, speaker = self.pick(audio, rate, ref_text)
            return self.engine.speak(text, lang, name, slot), speaker


# ---------------------------------------------------------------- HTTP

def serve(voice: Voice, port: int):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, code, body=b"", ctype="application/json", headers=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                self.reply(200, b'{"status":"ok"}')
            else:
                self.reply(404)

        def do_POST(self):
            try:
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                if self.path == "/reset":
                    voice.reset()
                    return self.reply(200, b"{}")
                if self.path != "/speak":
                    return self.reply(404)
                req = json.loads(body)
                pcm = np.frombuffer(base64.b64decode(req["pcm"]), dtype="<i2").astype(np.float32) / 32768.0
                t0 = time.time()
                wav, speaker = voice.speak(
                    req["text"], req.get("lang", "ru"), pcm, int(req["rate"]), req.get("ref_text") or "", float(req["slot"])
                )
                ms = int((time.time() - t0) * 1000)
                lead = req.get("lead")
                print(
                    f"[tts] {ms} ms, {wav_seconds(wav):.1f}s of slot {float(req['slot']):.1f}s, "
                    f"lead {lead if lead is None else round(lead, 1)}s, speaker {speaker}: {req['text']}",
                    flush=True,
                )
                self.reply(200, wav, "audio/wav", {"X-Gen-Ms": str(ms), "X-Speaker": str(speaker)})
            except Exception as e:  # noqa: BLE001 — report, keep serving
                traceback.print_exc()
                self.reply(500, json.dumps({"error": str(e)}).encode())

    HTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--speaker-model", required=True)
    p.add_argument("--engine-url", required=True, help="omnivoice.cpp tts-server, e.g. http://127.0.0.1:8080")
    p.add_argument("--steps", type=int, default=16, help="MaskGIT steps per line (model default 32; fewer is faster)")
    a = p.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    engine = Engine(a.engine_url, steps=a.steps)
    v = Voice(engine, SherpaEmbedder(a.speaker_model))
    # Warm-up: the first generation builds the compute graphs.
    engine.speak("Проверка.", "ru", None, 2.0)
    print("[tts] ready (omnivoice.cpp)", flush=True)
    serve(v, a.port)
