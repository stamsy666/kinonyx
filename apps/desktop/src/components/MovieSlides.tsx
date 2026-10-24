import { useEffect, useState } from "react";
import { preloadImage } from "../data/imagePreload";
import { ProgressiveImg } from "./ProgressiveImg";

export interface Slide {
  src: string;
  preview?: string;
}

/** The first frame stands still for a moment, as a poster would. */
const FIRST_HOLD_MS = 2600;
/** How long each frame is the main one; the change itself (a cross-fade) is slower than a blink. */
const SLIDE_MS = 8000;

/**
 * The film page's backdrop: its first screenshot stands still for two or three seconds, then the screenshots
 * follow one another — each slowly grows while it is on, and gives way to the next by a long cross-fade (the
 * old one keeps growing while it fades, so nothing jerks). The next frame is loaded before it is needed.
 */
export function MovieSlides({ slides }: { slides: Slide[] }) {
  const count = slides.length;
  const [state, setState] = useState<{ index: number; prev: number | null }>({ index: 0, prev: null });
  // `started` — the first frame has held for its moment and begins to grow (and the show goes on).
  const [started, setStarted] = useState(false);

  useEffect(() => {
    setState({ index: 0, prev: null });
    setStarted(false);
  }, [count]);

  useEffect(() => {
    if (count < 2) return;
    let cancelled = false;
    let timer = 0;
    const next = (from: number) => {
      const to = (from + 1) % count;
      // The next frame is ready (or has had its chance) before the change begins.
      void Promise.race([preloadImage(slides[to].src), new Promise((r) => window.setTimeout(r, 2500))]).then(() => {
        if (cancelled) return;
        setState({ index: to, prev: from });
        timer = window.setTimeout(() => next(to), SLIDE_MS);
      });
    };
    timer = window.setTimeout(() => {
      if (cancelled) return;
      setStarted(true);
      next(0);
    }, FIRST_HOLD_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, slides[0]?.src]);

  useEffect(() => {
    if (count > 1) void preloadImage(slides[1].src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  return (
    <div className="mtv__slides" aria-hidden="true">
      {slides.map((s, i) => {
        const active = i === state.index;
        const on = active || i === state.prev;
        // The first frame does not grow until the hold is over.
        const grows = on && (i !== 0 || started || state.index !== 0 || state.prev !== null);
        return (
          <div
            key={s.src}
            className={`mtv__slide ${active ? "is-active" : ""} ${i === state.prev ? "is-prev" : ""} ${grows ? "is-growing" : ""} ${i === 0 && !started && state.prev === null ? "is-still" : ""}`}
          >
            {(on || i === 0) && <ProgressiveImg src={s.src} placeholder={s.preview} />}
          </div>
        );
      })}
    </div>
  );
}
