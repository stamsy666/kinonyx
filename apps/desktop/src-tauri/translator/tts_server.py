"""KINONYX voice-over server: speaks each translated line in the voice of whoever said it.

Runs inside the app's own Python (engines/tts). One request per line:

    POST /speak  {"text", "lang", "pcm" (base64 s16le mono), "rate", "ref_text", "slot"}
      -> audio/wav (s16le mono, 24 kHz); X-Gen-Ms, X-Speaker headers
    POST /reset  forget the voices of the previous channel
    GET  /health

The line's own source audio is the voice reference whenever it is long enough (timbre and
intonation of that very utterance). Short lines ("Yes.", "What?") make poor references, so
every speaker heard so far keeps a bank entry — recognised by a voiceprint — whose best clip
stands in for them.
"""

import argparse
import base64
import io
import json
import sys
import threading
import time
import traceback
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import torch

MIN_OWN_S = 3.0          # a line at least this long is its own voice reference
MIN_EMBED_S = 0.6        # shorter audio gives unreliable voiceprints
SAME_SPEAKER = 0.5       # cosine similarity above which two clips are the same person
MAX_SPEAKERS = 8
BEST_REF_S = (5.0, 10.0) # preferred length of a bank reference
MAX_SPEEDUP = 1.35       # how much faster than natural a line may be spoken to fit its slot


class Speaker:
    def __init__(self, emb, prompt, dur):
        self.emb, self.prompt, self.dur, self.n, self.used = emb, prompt, dur, 1, time.time()

    @staticmethod
    def ref_quality(dur):
        lo, hi = BEST_REF_S
        return -abs(min(max(dur, lo), hi) - dur) - (0 if dur >= MIN_OWN_S else 100)


class Voice:
    def __init__(self, model_dir, speaker_model, steps):
        from omnivoice import OmniVoice
        from omnivoice.models.omnivoice import OmniVoiceGenerationConfig
        import sherpa_onnx

        self.model = OmniVoice.from_pretrained(model_dir, device_map="cuda:0", dtype=torch.float16)
        self.sr = 24000
        self.frame_rate = self.model.audio_tokenizer.config.frame_rate
        self.config = OmniVoiceGenerationConfig(num_step=steps)
        self.embedder = sherpa_onnx.SpeakerEmbeddingExtractor(
            sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=speaker_model, num_threads=2, provider="cpu")
        )
        self.speakers: list[Speaker] = []
        self.lock = threading.Lock()

    def reset(self):
        with self.lock:
            self.speakers.clear()

    def embed(self, audio, rate):
        s = self.embedder.create_stream()
        s.accept_waveform(rate, audio)
        s.input_finished()
        e = np.array(self.embedder.compute(s), dtype=np.float32)
        return e / (np.linalg.norm(e) + 1e-9)

    def prompt(self, audio, rate, text):
        wav = torch.from_numpy(audio).unsqueeze(0)
        return self.model.create_voice_clone_prompt((wav, rate), ref_text=text)

    def pick(self, audio, rate, ref_text):
        """Reference prompt for this line, keeping the speaker bank up to date."""
        dur = len(audio) / rate
        emb = self.embed(audio, rate) if dur >= MIN_EMBED_S else None
        best, sim = None, -1.0
        if emb is not None:
            for sp in self.speakers:
                c = float(emb @ sp.emb)
                if c > sim:
                    best, sim = sp, c
        same = best is not None and sim >= SAME_SPEAKER

        if dur >= MIN_OWN_S:
            own = self.prompt(audio, rate, ref_text)
            if same:
                best.emb = best.emb * best.n + emb
                best.n += 1
                best.emb /= np.linalg.norm(best.emb) + 1e-9
                if Speaker.ref_quality(dur) > Speaker.ref_quality(best.dur):
                    best.prompt, best.dur = own, dur
                best.used = time.time()
                return own, self.speakers.index(best)
            if emb is not None:
                if len(self.speakers) >= MAX_SPEAKERS:
                    self.speakers.remove(min(self.speakers, key=lambda s: s.used))
                self.speakers.append(Speaker(emb, own, dur))
                return own, len(self.speakers) - 1
            return own, -1
        if same or (best is not None and dur < 1.5):
            best.used = time.time()
            return best.prompt, self.speakers.index(best)
        return self.prompt(audio, rate, ref_text), -1

    @torch.inference_mode()
    def speak(self, text, lang, audio, rate, ref_text, slot):
        with self.lock:
            prompt, speaker = self.pick(audio, rate, ref_text)
            est_tokens = self.model._estimate_target_tokens(text, prompt.ref_text, prompt.ref_audio_tokens.size(-1))
            natural = est_tokens / self.frame_rate
            target = natural if natural <= slot else max(slot, natural / MAX_SPEEDUP)
            out = self.model.generate(
                text=text, language=lang, voice_clone_prompt=prompt, duration=target, generation_config=self.config
            )[0]
            # Give the activation memory back between lines: the card is shared with Whisper
            # and the translator, and PyTorch would otherwise keep its peak reserved forever.
            torch.cuda.empty_cache()
            return np.asarray(out, dtype=np.float32).reshape(-1), speaker


def to_wav(samples, rate):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


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
                audio, speaker = voice.speak(
                    req["text"], req.get("lang", "ru"), pcm, int(req["rate"]), req.get("ref_text") or "", float(req["slot"])
                )
                ms = int((time.time() - t0) * 1000)
                lead = req.get("lead")
                print(
                    f"[tts] {ms} ms, {len(audio) / voice.sr:.1f}s of slot {float(req['slot']):.1f}s, "
                    f"lead {lead if lead is None else round(lead, 1)}s, speaker {speaker}: {req['text']}",
                    flush=True,
                )
                self.reply(200, to_wav(audio, voice.sr), "audio/wav", {"X-Gen-Ms": str(ms), "X-Speaker": str(speaker)})
            except Exception as e:  # noqa: BLE001 — report, keep serving
                traceback.print_exc()
                self.reply(500, json.dumps({"error": str(e)}).encode())

    HTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--model", required=True)
    p.add_argument("--speaker-model", required=True)
    p.add_argument("--steps", type=int, default=16)
    a = p.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    v = Voice(a.model, a.speaker_model, a.steps)
    # Warm-up: the first generation compiles kernels and allocates buffers.
    v.speak("Проверка.", "ru", np.zeros(24000 * 3, np.float32) + 1e-4, 24000, "Test.", 2.0)
    v.reset()
    mb = lambda n: f"{n / 2**20:.0f} MiB"
    print(f"[tts] ready, GPU allocated {mb(torch.cuda.memory_allocated())}, peak {mb(torch.cuda.max_memory_allocated())}", flush=True)
    serve(v, a.port)
