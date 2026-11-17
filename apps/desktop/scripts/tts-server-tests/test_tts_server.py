"""Tests for src-tauri/translator/tts_server.py against a fake omnivoice.cpp engine (no GPU needed).

    cd apps/desktop/scripts/tts-server-tests && python -m unittest -v
"""

import base64
import io
import json
import os
import sys
import threading
import unittest
import urllib.request
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "src-tauri", "translator"))
sys.path.insert(0, HERE)

import tts_server as ts  # noqa: E402
from fake_engine import make_server  # noqa: E402

RATE = 16000


def voice_clip(f0, seconds):
    """Speaker identity in the fake embedder is the pitch: same f0 = same person."""
    t = np.arange(int(seconds * RATE)) / RATE
    return (0.3 * np.sin(2 * np.pi * f0 * t)).astype(np.float32)


def fake_embed(audio, rate):
    # spectrum peak position as a one-hot-ish vector: identical for the same f0, orthogonal otherwise
    spec = np.abs(np.fft.rfft(audio[: rate]))
    k = int(np.argmax(spec) // 10)
    e = np.zeros(64, np.float32)
    e[k % 64] = 1.0
    return e


def secs(wav):
    with wave.open(io.BytesIO(wav), "rb") as w:
        return w.getnframes() / w.getframerate()


class VoiceBank(unittest.TestCase):
    def setUp(self):
        self.srv, self.state = make_server()
        self.engine = ts.Engine(url=f"http://127.0.0.1:{self.srv.server_port}", steps=16)
        self.voice = ts.Voice(self.engine, fake_embed)

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()

    def registrations(self):
        return [b["name"] for p, b in self.state["calls"] if p == "/v1/audio/voices"]

    def speeches(self):
        return [b for p, b in self.state["calls"] if p == "/v1/audio/speech"]

    def test_long_line_of_new_speaker_becomes_bank_entry_encoded_once(self):
        wav, spk = self.voice.speak("Привет, как дела?", "ru", voice_clip(120, 4.0), RATE, "Hi, how are you doing today?", 3.0)
        self.assertEqual(spk, 0)
        self.assertEqual(self.registrations(), ["spk0"])
        self.assertEqual(self.speeches()[-1]["voice"], "spk0")
        self.assertGreater(secs(wav), 0.1)

    def test_short_line_reuses_the_bank_without_encoding(self):
        self.voice.speak("Первая реплика.", "ru", voice_clip(120, 4.0), RATE, "The first line here.", 3.0)
        n = len(self.registrations())
        _, spk = self.voice.speak("Да.", "ru", voice_clip(120, 0.8), RATE, "Yes.", 0.8)
        self.assertEqual(spk, 0)
        self.assertEqual(len(self.registrations()), n)
        self.assertEqual(self.speeches()[-1]["voice"], "spk0")

    def test_same_speaker_long_line_with_worse_reference_goes_through_own_slot(self):
        self.voice.speak("Раз.", "ru", voice_clip(120, 7.0), RATE, "A long reference sentence here.", 6.0)
        self.voice.speak("Два.", "ru", voice_clip(120, 3.2), RATE, "A shorter one.", 3.0)
        self.assertEqual(self.registrations(), ["spk0", "own"])
        self.assertEqual(self.speeches()[-1]["voice"], "own")

    def test_same_speaker_better_reference_replaces_bank_clip(self):
        self.voice.speak("Раз.", "ru", voice_clip(120, 3.1), RATE, "Short reference.", 3.0)
        self.voice.speak("Два.", "ru", voice_clip(120, 7.0), RATE, "A much better long reference sentence.", 6.0)
        self.assertEqual(self.registrations(), ["spk0", "spk0"])
        self.assertEqual(self.speeches()[-1]["voice"], "spk0")

    def test_two_people_get_two_slots(self):
        _, a = self.voice.speak("Мужчина.", "ru", voice_clip(110, 4.0), RATE, "A man is speaking now.", 3.0)
        _, b = self.voice.speak("Женщина.", "ru", voice_clip(230, 4.0), RATE, "A woman is speaking now.", 3.0)
        self.assertEqual((a, b), (0, 1))
        self.assertEqual(self.registrations(), ["spk0", "spk1"])

    def test_bank_evicts_least_recent_and_reuses_its_slot(self):
        for i in range(ts.MAX_SPEAKERS + 1):
            self.voice.speak("Реплика.", "ru", voice_clip(100 + 25 * i, 4.0), RATE, f"Speaker number {i} talks.", 3.0)
        regs = self.registrations()
        self.assertEqual(len(set(regs)), ts.MAX_SPEAKERS)
        self.assertEqual(regs[-1], "spk0")  # the oldest speaker's slot went to the newest

    def test_no_transcript_and_unknown_voice_falls_back_to_no_reference(self):
        _, spk = self.voice.speak("Кто здесь?", "ru", voice_clip(150, 0.4), RATE, "", 1.5)
        self.assertEqual(spk, -1)
        self.assertNotIn("voice", self.speeches()[-1])
        self.assertEqual(self.registrations(), [])

    def test_timing_fields_are_sent(self):
        self.voice.speak("Текст.", "ru", voice_clip(120, 4.0), RATE, "Some text to clone.", 2.5)
        s = self.speeches()[-1]
        self.assertEqual((s["max_duration"], s["max_speedup"], s["steps"], s["response_format"]), (2.5, ts.MAX_SPEEDUP, 16, "wav"))

    def test_long_translation_is_sped_up_but_not_beyond_the_cap(self):
        ref = "Short ref text."  # 15 chars in 4 s -> slow speaker
        long_ru = "Это очень длинная реплика, которая не помещается в отведённое время"
        wav, _ = self.voice.speak(long_ru, "ru", voice_clip(120, 4.0), RATE, ref, 2.0)
        natural = len(long_ru) / (len(ref) / 4.0)
        self.assertAlmostEqual(secs(wav), natural / ts.MAX_SPEEDUP, delta=0.05)

    def test_reference_is_trimmed(self):
        self.voice.speak("Текст.", "ru", voice_clip(120, 30.0), RATE, "A very long monologue.", 3.0)
        reg = [b for p, b in self.state["calls"] if p == "/v1/audio/voices"][-1]
        with wave.open(io.BytesIO(base64.b64decode(reg["wav_b64"])), "rb") as w:
            self.assertLessEqual(w.getnframes() / w.getframerate(), ts.MAX_REF_S + 0.01)

    def test_reset_forgets_speakers(self):
        self.voice.speak("Раз.", "ru", voice_clip(120, 4.0), RATE, "Some text here.", 3.0)
        self.voice.reset()
        self.voice.speak("Два.", "ru", voice_clip(120, 4.0), RATE, "Some text here.", 3.0)
        self.assertEqual(self.registrations(), ["spk0", "spk0"])


class HttpContract(unittest.TestCase):
    """The app talks to /speak exactly as before."""

    def test_speak_endpoint(self):
        srv, state = make_server()
        engine = ts.Engine(url=f"http://127.0.0.1:{srv.server_port}", steps=16)
        voice = ts.Voice(engine, fake_embed)
        import socket
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        threading.Thread(target=ts.serve, args=(voice, port), daemon=True).start()
        pcm = (voice_clip(120, 4.0) * 32767).astype("<i2").tobytes()
        body = json.dumps({"text": "Привет.", "lang": "ru", "pcm": base64.b64encode(pcm).decode(), "rate": RATE,
                           "ref_text": "Hello there, my friend.", "slot": 2.0, "lead": 3.2}).encode()
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1)
                break
            except OSError:
                import time
                time.sleep(0.05)
        r = urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/speak", data=body, method="POST"))
        self.assertEqual(r.headers["Content-Type"], "audio/wav")
        self.assertEqual(r.headers["X-Speaker"], "0")
        self.assertGreater(secs(r.read()), 0.1)
        r = urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/reset", data=b"{}", method="POST"))
        self.assertEqual(r.status, 200)
        srv.shutdown()
        srv.server_close()


if __name__ == "__main__":
    unittest.main()
