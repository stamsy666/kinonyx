import { useEffect, useRef, useState, type CSSProperties } from "react";
import { create } from "zustand";
import { ANIMATED_KINDS, BG_PALETTES, type BgKind } from "../data/backgrounds";
import logoMark from "../assets/logo-mark.png";
import { AnimatedBackground } from "./backgrounds/AppBackground";

// Seconds, under a new key: the old one held minutes.
const KEY = "kinonyx.screensaverAfter";
const DEFAULT_SECONDS = 30;
/** Seconds of rest before it comes; 0 = never. */
export const SCREENSAVER_OPTIONS = [0, 30, 60, 300];

function readSeconds(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw == null ? DEFAULT_SECONDS : Number(raw);
    return SCREENSAVER_OPTIONS.includes(n) ? n : DEFAULT_SECONDS;
  } catch {
    return DEFAULT_SECONDS;
  }
}

export const useScreensaver = create<{ seconds: number; setSeconds: (s: number) => void }>((set) => ({
  seconds: readSeconds(),
  setSeconds(seconds) {
    set({ seconds });
    try {
      localStorage.setItem(KEY, String(seconds));
    } catch {
      /* the choice is not remembered */
    }
  },
}));

const CLOSE_MS = 600;
const motionQuery = "(prefers-reduced-motion: reduce)";
const clockFormat = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" });
const backgrounds = ANIMATED_KINDS.filter((kind) => kind !== "bw");
type Background = Exclude<BgKind, "bw">;

function IdleDisplay({ kind, closing }: { kind: Background; closing: boolean }) {
  const [now, setNow] = useState(() => new Date());
  const [reduceMotion, setReduceMotion] = useState(() => window.matchMedia(motionQuery).matches);

  useEffect(() => {
    let timer = 0;
    const update = () => {
      const next = new Date();
      setNow(next);
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 60_000 - (next.getTime() % 60_000));
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia(motionQuery);
    const sync = () => setReduceMotion(media.matches);
    media.addEventListener("change", sync);
    sync();
    return () => media.removeEventListener("change", sync);
  }, []);

  const palette = BG_PALETTES[kind];
  const colors = {
    "--ss-accent": palette.accent,
    "--ss-deep": palette.accentDeep,
  } as CSSProperties;

  return (
    <div className={`ss${closing ? " ss--closing" : ""}`} data-background={kind} style={colors}>
      {!reduceMotion && (
        <div className="ss__art" aria-hidden="true">
          <AnimatedBackground kind={kind} />
        </div>
      )}
      <div className="ss__brand">
        <img src={logoMark} alt="" />
        <span>KINON<em>YX</em></span>
      </div>
      <div className="ss__clock">
        <time className="ss__time" dateTime={now.toISOString()}>{clockFormat.format(now)}</time>
        <span className="ss__date">{dateFormat.format(now)}</span>
      </div>
    </div>
  );
}

export function Screensaver({
  theme,
  onVisibilityChange,
}: {
  theme: BgKind;
  onVisibilityChange: (visible: boolean) => void;
}) {
  const seconds = useScreensaver((s) => s.seconds);
  const lastRandomBackground = useRef<Background | null>(null);
  const [display, setDisplay] = useState<{ kind: Background; closing: boolean } | null>(null);

  useEffect(() => {
    setDisplay(null);
    if (!seconds) return;

    let idleTimer = 0;
    let closeTimer = 0;
    let visible = false;
    let shownAt = 0;
    let lastX = -1;
    let lastY = -1;

    const arm = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        let kind: Background;
        if (theme === "bw") {
          const next = backgrounds.filter((candidate) => candidate !== lastRandomBackground.current);
          kind = next[Math.floor(Math.random() * next.length)];
          lastRandomBackground.current = kind;
        } else {
          kind = theme;
        }
        shownAt = Date.now();
        visible = true;
        setDisplay({ kind, closing: false });
        onVisibilityChange(true);
      }, seconds * 1000);
    };
    const dismiss = () => {
      if (closeTimer) return;
      setDisplay((current) => current && { ...current, closing: true });
      closeTimer = window.setTimeout(() => {
        closeTimer = 0;
        visible = false;
        setDisplay(null);
        onVisibilityChange(false);
      }, window.matchMedia(motionQuery).matches ? 0 : CLOSE_MS);
    };
    const wake = (e: Event) => {
      if (visible) {
        e.preventDefault();
        e.stopImmediatePropagation();
        dismiss();
      }
      arm();
    };
    const move = (e: MouseEvent) => {
      const moved = Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 8;
      lastX = e.clientX;
      lastY = e.clientY;
      if (!moved || (visible && Date.now() - shownAt < 1500)) return;
      if (visible) dismiss();
      arm();
    };
    const inputEvents = ["keydown", "mousedown", "wheel", "touchstart"] as const;
    for (const type of inputEvents) window.addEventListener(type, wake, { capture: true, passive: false });
    window.addEventListener("mousemove", move, true);
    arm();
    return () => {
      window.clearTimeout(idleTimer);
      window.clearTimeout(closeTimer);
      for (const type of inputEvents) window.removeEventListener(type, wake, true);
      window.removeEventListener("mousemove", move, true);
      if (visible) onVisibilityChange(false);
    };
  }, [seconds, theme, onVisibilityChange]);

  return display && <IdleDisplay {...display} />;
}
