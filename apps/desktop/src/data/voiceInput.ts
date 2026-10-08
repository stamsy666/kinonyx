/** Microphone capture for voice search: records until the speaker pauses.
 *
 *  Output is what the Rust side expects: raw little-endian f32 samples, mono, 24 kHz (the
 *  AudioContext is created at that rate, so the browser does the resampling). */

export const VOICE_SAMPLE_RATE = 24_000;

const SPEECH_LEVEL = 0.02; // RMS above this counts as speech
const END_SILENCE_MS = 1200; // this long a pause after speech ends the recording
const GIVE_UP_MS = 8000; // nothing said at all for this long
const MAX_MS = 30000; // a hard cap so a recording never runs forever
const MANUAL_MAX_MS = MAX_MS;

export interface Recording {
  /** Resolves with the audio, or null if nothing was said / it was cancelled. */
  done: Promise<Uint8Array | null>;
  /** Stop now (and keep what was recorded so far if `keep`). */
  stop(keep: boolean): void;
}

export interface RecordOptions {
  /** End the recording by itself after a pause (default). Off: only `stop()` ends it (plus a hard cap). */
  autoStop?: boolean;
}

export async function recordUntilSilence(onLevel?: (rms: number) => void, opts: RecordOptions = {}): Promise<Recording> {
  const autoStop = opts.autoStop ?? true;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Микрофон недоступен");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    throw new Error("Нет доступа к микрофону — разрешите его в системе");
  }

  const ctx = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
  const source = ctx.createMediaStreamSource(stream);
  // Small buffer: ~43 ms per chunk, so the voice-level callback (the orb animation) stays smooth.
  const node = ctx.createScriptProcessor(1024, 1, 1);
  const chunks: Float32Array[] = [];
  let heardSpeech = false;
  let lastSpeechAt = 0;
  const startedAt = performance.now();
  let finish: (v: Uint8Array | null) => void = () => undefined;
  let closed = false;

  const close = async (keep: boolean) => {
    if (closed) return;
    closed = true;
    node.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => undefined);
    if (!keep || !heardSpeech) return finish(null);
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Float32Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    finish(new Uint8Array(out.buffer));
  };

  const done = new Promise<Uint8Array | null>((resolve) => {
    finish = resolve;
  });

  node.onaudioprocess = (e) => {
    if (closed) return;
    const data = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    onLevel?.(rms);
    const now = performance.now();
    if (rms > SPEECH_LEVEL) {
      heardSpeech = true;
      lastSpeechAt = now;
    }
    if (autoStop && heardSpeech && now - lastSpeechAt > END_SILENCE_MS) void close(true);
    else if (autoStop && !heardSpeech && now - startedAt > GIVE_UP_MS) void close(false);
    else if (now - startedAt > (autoStop ? MAX_MS : MANUAL_MAX_MS)) void close(true);
  };
  source.connect(node);
  node.connect(ctx.destination); // a ScriptProcessor only runs while connected; it outputs silence

  return { done, stop: (keep) => void close(keep) };
}
