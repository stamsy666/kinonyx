import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { useFavorites } from "../store/favorites";
import { useContinueWatching } from "../store/continueWatching";
import { img } from "../data/images";
import { kpImages } from "../data/api";
import logoMark from "../assets/logo-mark.png";

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
/** How long the new picture takes to come over the old one — the old stays under it, so there is no dip between them. */
const FADE_MS = 2400;
const CLOSE_MS = 600;

interface Slide {
  id: number;
  title: string;
  year?: string | number;
  poster?: string;
}

/** A frame of the film for the blurred background (one request per film, kept for the session; the disk cache does the rest). */
const stillCache = new Map<number, Promise<string | null>>();
function stillFor(id: number): Promise<string | null> {
  let p = stillCache.get(id);
  if (!p) {
    p = kpImages(id, "STILL", 1)
      .then((r) => {
        const items = r.items ?? [];
        const one = items[Math.min(2, items.length - 1)];
        return one ? one.previewUrl || one.imageUrl : null;
      })
      .catch(() => null);
    stillCache.set(id, p);
  }
  return p;
}

/** Loads a picture into the cache; never fails or hangs — a picture that does not come in 5 s is shown when it does. */
function preload(url: string | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!url) return resolve();
    const im = new Image();
    im.onload = () => resolve();
    im.onerror = () => resolve();
    im.src = url;
    window.setTimeout(resolve, 5000);
  });
}

/**
 * After a while with no key, mouse or touch, the screen is taken by the viewer's own films: their posters (favourites and what is
 * being watched) over a blurred frame of the film, with the name of the programme and the time. It comes up slowly, the pictures
 * change by melting into one another, and it also keeps the television from showing one picture for hours. The first thing the
 * viewer does wakes it — and does nothing else (the first key press is swallowed).
 */
export function Screensaver() {
  const seconds = useScreensaver((s) => s.seconds);
  const favorites = useFavorites((s) => s.items);
  const watching = useContinueWatching((s) => s.items);
  const [on, setOn] = useState(false);
  const [closing, setClosing] = useState(false);
  const onRef = useRef(false);
  onRef.current = on;
  const closingRef = useRef(false);
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
        if (closingRef.current) return;
        shownAt.current = Date.now();
        setOn(true);
      }, seconds * 1000);
    };
    // It goes away as slowly as a blink, not at once.
    const dismiss = () => {
      if (closingRef.current) return;
      closingRef.current = true;
      setClosing(true);
      window.setTimeout(() => {
        closingRef.current = false;
        setClosing(false);
        setOn(false);
      }, CLOSE_MS);
    };
    const wake = (e: Event) => {
      if (onRef.current) {
        // What woke the screen does not reach the page under it.
        e.preventDefault();
        e.stopPropagation();
        dismiss();
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
      if (onRef.current) dismiss();
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
  const [stills, setStills] = useState<Record<number, string>>({});

  // The next picture is got ready (its frame asked for, both pictures loaded) while the present one is on, and put on only when
  // it is ready — so it never comes up half drawn.
  useEffect(() => {
    if (!on) return;
    setIndex(0);
    setPrevious(null);
    let dead = false;
    let timer = 0;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, ms);
      });
    const prepare = (i: number): Promise<void> => {
      const s = slides[i];
      if (!s) return Promise.resolve();
      const poster = preload(img(s.poster));
      const frame = stillFor(s.id).then((url) => {
        if (!url) return;
        if (!dead) setStills((m) => (m[s.id] === url ? m : { ...m, [s.id]: url }));
        return preload(img(url));
      });
      return Promise.all([poster, frame]).then(() => undefined);
    };
    void (async () => {
      void prepare(0);
      if (slides.length < 2) return;
      let at = 0;
      while (!dead) {
        const next = (at + 1) % slides.length;
        const ready = prepare(next);
        await wait(SLIDE_MS);
        await ready;
        if (dead) return;
        setPrevious(at);
        setIndex(next);
        at = next;
      }
    })();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [on, slides]);

  // The old picture stays under the new one until the new one has come all the way.
  useEffect(() => {
    if (previous === null) return;
    const t = window.setTimeout(() => setPrevious(null), FADE_MS + 200);
    return () => window.clearTimeout(t);
  }, [previous]);

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
    const still = stills[s.id];
    return (
      <div className={`ss__slide ${cls}`} key={s.id} style={{ ["--ss-shift" as string]: `${shift}px` }}>
        <div className="ss__backdrop" style={{ backgroundImage: `url(${img(s.poster)})` }} />
        {still && <img className="ss__still" src={img(still)} alt="" onLoad={(e) => e.currentTarget.classList.add("is-in")} />}
        <div className="ss__card">
          <img src={img(s.poster)} alt="" />
          <div className="ss__title">{s.title}</div>
          {s.year ? <div className="ss__year">{s.year}</div> : null}
        </div>
      </div>
    );
  };

  return (
    <div className={`ss ${closing ? "ss--closing" : ""}`} role="presentation">
      {draw(previous, "ss__slide--under")}
      {draw(index, previous === null ? "" : "ss__slide--in")}
      <div className="ss__top topbar__logo" aria-hidden="true">
        <img className="topbar__logo-mark" src={logoMark} alt="" />
        <span>
          KINON<em>YX</em>
        </span>
      </div>
      <div className="ss__clock">
        <b>{now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</b>
        <span>{now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}</span>
      </div>
    </div>
  );
}
