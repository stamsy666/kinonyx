import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { useFavorites } from "../store/favorites";
import { useContinueWatching } from "../store/continueWatching";
import { img } from "../data/images";

// Seconds, under a new key: the old one held minutes.
const KEY = "kinonyx.screensaverAfter";
const DEFAULT_SECONDS = 300;
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

const SLIDE_MS = 12_000;

interface Slide {
  id: number;
  title: string;
  year?: string | number;
  poster?: string;
}

/**
 * After a while with no key, mouse or touch, the screen is taken by the viewer's own films: their posters (favourites and what is
 * being watched) drift slowly, with the time. It also keeps the television from showing one picture for hours. The first
 * thing the viewer does wakes it — and does nothing else (the first key press is swallowed).
 */
export function Screensaver() {
  const seconds = useScreensaver((s) => s.seconds);
  const favorites = useFavorites((s) => s.items);
  const watching = useContinueWatching((s) => s.items);
  const [on, setOn] = useState(false);
  const onRef = useRef(false);
  onRef.current = on;
  const shownAt = useRef(0);

  useEffect(() => {
    if (!seconds) {
      setOn(false);
      return;
    }
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        shownAt.current = Date.now();
        setOn(true);
      }, seconds * 1000);
    };
    const wake = (e: Event) => {
      if (onRef.current) {
        // What woke the screen does not reach the page under it.
        e.preventDefault();
        e.stopPropagation();
        setOn(false);
      }
      arm();
    };
    let lastX = -1;
    let lastY = -1;
    const move = (e: MouseEvent) => {
      // The mouse jitters on its own sometimes: only a real movement counts, and not at the moment the screen came.
      const moved = Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 8;
      lastX = e.clientX;
      lastY = e.clientY;
      if (!moved || Date.now() - shownAt.current < 1500) return;
      if (onRef.current) setOn(false);
      arm();
    };
    const hard = ["keydown", "mousedown", "wheel", "touchstart"] as const;
    for (const t of hard) window.addEventListener(t, wake, true);
    window.addEventListener("mousemove", move, true);
    arm();
    return () => {
      window.clearTimeout(timer);
      for (const t of hard) window.removeEventListener(t, wake, true);
      window.removeEventListener("mousemove", move, true);
    };
  }, [seconds]);

  const slides: Slide[] = useMemo(() => {
    const out: Slide[] = [
      ...favorites.map((f) => ({ id: f.kinopoiskId, title: f.nameRu || f.nameOriginal || "", year: f.year, poster: f.posterUrl ?? f.posterUrlPreview })),
      ...watching.map((w) => ({ id: w.filmId, title: w.title, year: w.film?.year, poster: w.poster })),
    ].filter((s) => s.poster && s.title);
    const seen = new Set<number>();
    const unique = out.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
    // A different order each time it comes.
    return unique.sort(() => Math.random() - 0.5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  const [index, setIndex] = useState(0);
  const [previous, setPrevious] = useState<number | null>(null);
  useEffect(() => {
    if (!on || slides.length < 2) return;
    const t = window.setInterval(() => {
      setIndex((i) => {
        setPrevious(i);
        return (i + 1) % slides.length;
      });
    }, SLIDE_MS);
    return () => window.clearInterval(t);
  }, [on, slides.length]);
  useEffect(() => {
    if (on) {
      setIndex(0);
      setPrevious(null);
    }
  }, [on]);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!on) return;
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, [on]);

  if (!on) return null;
  const draw = (i: number | null, cls: string) => {
    const s = i === null ? undefined : slides[i];
    if (!s) return null;
    // The picture sits a little differently each time: nothing stays on the same pixels.
    const shift = ((s.id * 37) % 60) - 30;
    return (
      <div className={`ss__slide ${cls}`} key={`${cls}:${i}:${s.id}`} style={{ ["--ss-shift" as string]: `${shift}px` }}>
        <div className="ss__backdrop" style={{ backgroundImage: `url(${img(s.poster)})` }} />
        <div className="ss__card">
          <img src={img(s.poster)} alt="" />
          <div className="ss__title">{s.title}</div>
          {s.year ? <div className="ss__year">{s.year}</div> : null}
        </div>
      </div>
    );
  };

  return (
    <div className="ss" role="presentation">
      {draw(previous, "ss__slide--out")}
      {draw(index, "ss__slide--in")}
      {slides.length === 0 && <div className="ss__brand">KINONYX</div>}
      <div className="ss__clock">
        <b>{now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</b>
        <span>{now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}</span>
      </div>
    </div>
  );
}
