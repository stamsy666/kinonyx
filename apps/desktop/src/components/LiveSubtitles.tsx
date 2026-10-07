import { useEffect, useMemo, useRef, useState } from "react";
import { DUCK_FILTER, type PlaySource } from "@kinonyx/player-core";
import { useTranslator } from "../store/translator";
import { useApp } from "../store/app";
import {
  onCue,
  onSessionStatus,
  onVoice,
  translatorPosition,
  translatorStart,
  translatorStop,
  translatorVoice,
  type Cue,
  type VoiceClip,
} from "../data/translator";

export type LiveTranslationState = "off" | "starting" | "ready" | "error";
export type VoiceState = "off" | "starting" | "ready" | "error";

/**
 * Runs a local-translation session for `base` while `enabled`: the player is switched to the
 * session's relay (the same broadcast, `delay` seconds behind) and timed Russian cues arrive
 * as the speech ahead of it is recognized and translated.
 *
 * Returns the source to actually play — `null` while the session is starting, so the direct
 * stream isn't kept open alongside the recorder (many providers allow one connection).
 *
 * `voice` switches voice-over on the running session (no restart): spoken clips then arrive
 * in `clips`, for `useVoiceOver` to play.
 */
export function useLiveTranslation(base: PlaySource | null, enabled: boolean, voice: boolean, position: number, playing: boolean) {
  const { asrModel, mtModel, sourceLang, delay } = useTranslator();
  const [session, setSession] = useState<{ id: number; playUrl: string } | null>(null);
  const [state, setState] = useState<LiveTranslationState>("off");
  const [error, setError] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [clips, setClips] = useState<VoiceClip[]>([]);
  const [voiceState, setVoiceState] = useState<VoiceState>("off");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  // Bumped when the broadcast stalls: tears the session down and starts a fresh one.
  const [restart, setRestart] = useState(0);
  // Whether the delayed broadcast has actually started playing in this session — until
  // then the player's "buffering" is the deliberate head start, not a network problem.
  const [started, setStarted] = useState(false);
  const sessionRef = useRef<number | null>(null);
  const lastStallRef = useRef(0);

  useEffect(() => {
    if (session && playing) setStarted(true);
  }, [session, playing]);

  useEffect(() => {
    if (!enabled || !base) {
      setState("off");
      return;
    }
    let cancelled = false;
    let startedId: number | null = null;
    setState("starting");
    setError(null);
    setCues([]);
    setClips([]);
    setSession(null);
    setStarted(false);
    translatorStart({ url: base.url, asrModel, mtModel, sourceLang, voice: voiceRef.current })
      .then((r) => {
        if (cancelled) {
          void translatorStop(r.session);
          return;
        }
        startedId = r.session;
        sessionRef.current = r.session;
        setSession({ id: r.session, playUrl: r.playUrl });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState("error");
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      sessionRef.current = null;
      setSession(null);
      if (startedId != null) void translatorStop(startedId);
    };
    // Model/delay choices are read at start; changing them applies from the next session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, base?.url, restart]);

  useEffect(() => {
    let alive = true;
    const offs: (() => void)[] = [];
    void onCue((c) => {
      if (c.session !== sessionRef.current) return;
      setCues((list) => [...list.filter((x) => x.end > c.start - 120), c].sort((a, b) => a.start - b.start));
    }).then((f) => (alive ? offs.push(f) : f()));
    void onVoice((c) => {
      if (c.session !== sessionRef.current) return;
      setClips((list) => [...list.filter((x) => x.end > c.start - 60), c]);
    }).then((f) => (alive ? offs.push(f) : f()));
    void onSessionStatus((s) => {
      if (s.session !== sessionRef.current) return;
      if (s.state === "voice-starting") setVoiceState("starting");
      else if (s.state === "voice-ready") setVoiceState("ready");
      else if (s.state === "voice-error") {
        setVoiceState("error");
        setVoiceError(s.message ?? "озвучка не запустилась");
      } else if (s.state === "error") {
        setState("error");
        setError(s.message ?? "Переводчик не запустился");
      } else if (s.state === "stalled") {
        // A dead connection recovers with a fresh one; a provider whose playlist itself has
        // frozen (seen live: same HLS media sequence for minutes) would just replay the same
        // 30 s on every reconnect — so a second stall soon after the first gives up.
        const now = Date.now();
        if (now - lastStallRef.current < 120_000) {
          setState("error");
          setError("провайдер перестал отдавать эфир этого канала. Попробуйте позже или другой канал.");
        } else {
          lastStallRef.current = now;
          setRestart((n) => n + 1);
        }
      } else setState(s.state);
    }).then((f) => (alive ? offs.push(f) : f()));
    return () => {
      alive = false;
      offs.forEach((f) => f());
    };
  }, []);

  // Voice-over follows the toggle on the running session.
  useEffect(() => {
    if (!session) return;
    if (voice) {
      setVoiceError(null);
      setVoiceState((v) => (v === "ready" ? v : "starting"));
    } else {
      setVoiceState("off");
      setClips([]);
    }
    void translatorVoice(session.id, voice).catch(() => undefined);
  }, [session, voice]);

  // The pipeline uses the player's position to see how much lookahead is left.
  const posRef = useRef(position);
  posRef.current = position;
  useEffect(() => {
    if (!session) return;
    const t = window.setInterval(() => void translatorPosition(session.id, posRef.current).catch(() => undefined), 1000);
    return () => window.clearInterval(t);
  }, [session]);

  const source: PlaySource | null = useMemo(() => {
    if (!enabled) return base;
    if (!base || !session) return null;
    return {
      ...base,
      url: session.playUrl,
      live: true,
      mpvOptions: {
        ...base.mpvOptions,
        // The voice-over duck filter goes after the viewer's own audio filter (night mode).
        af: [base.mpvOptions?.af, DUCK_FILTER].filter(Boolean).join(","),
        // Same timeline as the audio decoder feeding the translator (both read the relay).
        "rebase-start-time": "no",
        // Start only once `delay` seconds are buffered: that head start is the translator's.
        "cache-pause-initial": "yes",
        "cache-pause-wait": String(delay),
      },
    };
  }, [enabled, base, session, delay]);

  return { source, state, error, cues, delay, started, clips, voiceState, voiceError };
}

const MIN_SECONDS = 1.3;
const CHARS_PER_SECOND = 15;

/** The cue on screen at `position`: each stays at least long enough to read (capped by the
 *  next one's start), so short phrases don't flash by. */
export function currentCue(cues: Cue[], position: number): Cue | null {
  for (let i = cues.length - 1; i >= 0; i--) {
    const c = cues[i];
    if (c.start > position) continue;
    const readable = c.start + Math.max(MIN_SECONDS, c.text.length / CHARS_PER_SECOND);
    const next = cues[i + 1]?.start ?? Infinity;
    const end = Math.min(Math.max(c.end + 0.4, readable), next - 0.05);
    return position < end ? c : null;
  }
  return null;
}

export function LiveSubtitles({
  cues,
  position,
  active,
  note,
  raised,
}: {
  cues: Cue[];
  position: number;
  active: boolean;
  /** A one-off message (why translation is unavailable/was switched off). */
  note: string | null;
  raised: boolean;
}) {
  const prefs = useApp((s) => s.playerPrefs);
  const cue = active ? currentCue(cues, position) : null;
  if (!cue && !note) return null;
  return (
    <div
      className={`live-subs ${raised ? "live-subs--raised" : ""}`}
      style={{ "--sub-scale": prefs.subtitleScale, "--sub-color": prefs.subtitleColor } as React.CSSProperties}
      aria-live="polite"
    >
      {cue ? <p className="live-subs__text">{cue.text}</p> : <p className="live-subs__note">{note}</p>}
    </div>
  );
}
