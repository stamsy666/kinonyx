import { useEffect, useRef } from "react";
import type { VoiceClip } from "../data/translator";

/** How far the original is turned down under a Russian line (TV voice-over style). */
const DUCK = 0.22;
/** Ducking fades over ~150 ms (three 50 ms ticks) instead of stepping. */
const DUCK_STEP = 0.27;
/** A clip that would start this much later than its moment (queued behind a long previous
 *  one) is dropped: late speech over the wrong picture is worse than none. */
const MAX_LAG = 3;
/** A clip queued behind the previous one plays slightly faster to win the lag back
 *  (pitch rises with it, so the catch-up stays gentle). */
const MAX_CATCHUP = 1.12;
const TICK_MS = 50;

let ctx: AudioContext | null = null;

/** The shared audio context. Call it from the key/click handler that switches voice-over on:
 *  a context created (or resumed) inside a user gesture is allowed to play. */
export function voiceAudio(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: "interactive" });
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function decode(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

interface Scheduled {
  node: AudioBufferSourceNode;
  /** Audio-context time span the clip occupies. */
  from: number;
  to: number;
}

/**
 * Plays voice-over clips in step with the picture: each starts when the player reaches its
 * `start`, the original is ducked while it speaks, pausing the player pauses the voice.
 * Positions between the player's (irregular) updates are extrapolated from the wall clock.
 */
export function useVoiceOver({
  enabled,
  clips,
  position,
  playing,
  volume,
  muted,
  setDuck,
}: {
  enabled: boolean;
  clips: VoiceClip[];
  position: number;
  playing: boolean;
  volume: number;
  muted: boolean;
  setDuck: (gain: number) => void;
}) {
  const pos = useRef({ value: position, at: performance.now(), playing });
  if (pos.current.value !== position || pos.current.playing !== playing) {
    pos.current = { value: position, at: performance.now(), playing };
  }
  const buffers = useRef(new Map<number, AudioBuffer | "pending" | "failed">());
  const done = useRef(new Set<number>());
  const scheduled = useRef<Scheduled[]>([]);
  const gain = useRef<GainNode | null>(null);
  const duck = useRef(1);
  const setDuckRef = useRef(setDuck);
  setDuckRef.current = setDuck;
  const clipsRef = useRef(clips);
  clipsRef.current = clips;

  // Decode clips as they arrive — well before their moment.
  useEffect(() => {
    if (!enabled) return;
    const ac = voiceAudio();
    for (const c of clips) {
      if (buffers.current.has(c.start)) continue;
      buffers.current.set(c.start, "pending");
      ac.decodeAudioData(decode(c.audio)).then(
        (b) => buffers.current.set(c.start, b),
        () => buffers.current.set(c.start, "failed"),
      );
    }
  }, [enabled, clips]);

  useEffect(() => {
    if (gain.current) gain.current.gain.value = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    if (!enabled) return;
    const ac = voiceAudio();
    const g = ac.createGain();
    g.gain.value = muted ? 0 : volume;
    g.connect(ac.destination);
    gain.current = g;
    let lastEst = Number.NaN;
    let lastWall = performance.now();

    const stopAll = () => {
      for (const s of scheduled.current) {
        try {
          s.node.stop();
        } catch {
          /* already ended */
        }
      }
      scheduled.current = [];
    };

    const tick = () => {
      const p = pos.current;
      const now = performance.now();
      const est = p.playing ? p.value + (now - p.at) / 1000 : p.value;
      // A jump (seek, stream restart) invalidates everything already queued.
      if (Number.isFinite(lastEst) && Math.abs(est - lastEst - (p.playing ? (now - lastWall) / 1000 : 0)) > 1.5) {
        stopAll();
        done.current.clear();
      }
      lastEst = est;
      lastWall = now;

      if (!p.playing) {
        if (ac.state === "running") void ac.suspend();
      } else {
        if (ac.state === "suspended") void ac.resume();
        const t = ac.currentTime;
        scheduled.current = scheduled.current.filter((s) => s.to > t - 1);
        for (const c of clipsRef.current) {
          if (done.current.has(c.start)) continue;
          const lead = c.start - est;
          if (lead > 0.3) continue;
          const buf = buffers.current.get(c.start);
          if (buf === "pending" || buf === undefined) {
            if (lead < -MAX_LAG) done.current.add(c.start);
            continue;
          }
          done.current.add(c.start);
          if (buf === "failed") continue;
          // Due time may already be past (late clip) or taken by the previous line: then it
          // starts as soon as possible, whole, a little faster to win the lag back.
          const due = t + lead;
          let when = Math.max(t, due);
          const busy = scheduled.current.reduce((m, s) => Math.max(m, s.to), 0);
          if (busy > when) when = busy + 0.05;
          const lag = when - due;
          if (lag > MAX_LAG) continue;
          const rate = lag > 0.2 ? Math.min(MAX_CATCHUP, 1 + lag * 0.06) : 1;
          const node = ac.createBufferSource();
          node.buffer = buf;
          node.playbackRate.value = rate;
          node.connect(g);
          node.start(when);
          scheduled.current.push({ node, from: when, to: when + buf.duration / rate });
        }
      }

      const t = ac.currentTime;
      const speaking = p.playing && scheduled.current.some((s) => t >= s.from - 0.12 && t <= s.to + 0.2);
      const target = speaking ? DUCK : 1;
      if (duck.current !== target) {
        duck.current = target < duck.current ? Math.max(target, duck.current - DUCK_STEP) : Math.min(target, duck.current + DUCK_STEP);
        setDuckRef.current(duck.current);
      }
    };
    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearInterval(timer);
      stopAll();
      g.disconnect();
      gain.current = null;
      if (duck.current !== 1) {
        duck.current = 1;
        setDuckRef.current(1);
      }
    };
    // volume/muted are applied by their own effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Forget clips of a finished session.
  useEffect(() => {
    if (clips.length === 0) {
      buffers.current.clear();
      done.current.clear();
    }
  }, [clips]);
}
