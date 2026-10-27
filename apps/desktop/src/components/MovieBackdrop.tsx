import { useEffect, useRef, useState, type ReactNode } from "react";
import { BackIcon, EpisodesIcon, ExpandIcon, GearIcon, MiniPlayerIcon, MuteIcon, onBack, PauseIcon, PlayIcon, VolumeIcon } from "@kinonyx/ui";
import { loadBackdropTrailer, type BackdropTrailer } from "../data/backdropTrailer";
import { holdMusic } from "../data/music";
import { useApp } from "../store/app";
import { PlayFlash } from "./PlayFlash";
import { FIRST_HOLD_MS, MovieSlides, type Slide } from "./MovieSlides";

interface FilmNames {
  nameRu?: string;
  nameOriginal?: string;
  year?: string | number;
}

const SEEK_S = 10;
/** The phone remote's and the media keys' "back/forward" (the remote's buttons say 15 seconds). */
const REMOTE_SEEK_S = 15;
const VOLUME_STEP = 0.1;
const VOLUME_KEY = "kinonyx.trailerVolume";
const readVolume = () => {
  try {
    const v = Number.parseFloat(localStorage.getItem(VOLUME_KEY) ?? "");
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  } catch {
    return 1;
  }
};
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** How long the bar and the buttons stay after the last touch of the remote or the mouse. */
const CONTROLS_MS = 3500;

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

/** Where the remote's focus is in the grown trailer's bar. */
type Item = "back" | "list" | "play" | "vol" | "seek" | "quality" | "shape" | "pip";

/** How the grown trailer fills the window: cover it (the edges are cut), show all of it (bars), or stretch it. */
type Fit = "cover" | "contain" | "fill";
const FITS: Fit[] = ["cover", "contain", "fill"];
const FIT_LABELS: Record<Fit, string> = { cover: "Заполнить окно", contain: "Целиком", fill: "Растянуть" };
const FIT_KEY = "kinonyx.trailerFit";
interface Ui {
  /** The bar has the focus (arrows move along it); otherwise arrows seek. */
  bar: boolean;
  item: Item;
  /** A small list/level is open over the focused button. */
  popup: "vol" | "quality" | null;
  /** The row of the quality list under the cursor (0 = the sharpest). */
  cursor: number;
  /** The time bar is being scrubbed: left/right seek, OK or up/down let go. */
  scrub: boolean;
}
const IDLE_UI: Ui = { bar: false, item: "play", popup: null, cursor: 0, scrub: false };

const pipSupported = () => typeof document !== "undefined" && document.pictureInPictureEnabled === true;

/**
 * The film page's backdrop — and the trailer player. The first frame stands still as before; then, if the film has
 * a trailer that was found by then, it melts in over the frames and plays without sound (the screenshots wait
 * under it, and come back when it is over). `expanded` — the trailer is grown over the page: the sound comes on and
 * a bar appears (play, volume, a bar to take hold of, quality, picture in picture); Back (or the end) gives the page
 * back. `chosen` — a trailer picked from the list: it plays at once, in place of the backdrop's own.
 */
export function MovieBackdrop({
  id,
  film,
  slides,
  fallback,
  expanded,
  chosen,
  onLive,
  onCollapse,
  onList,
}: {
  id: number;
  film: FilmNames;
  slides: Slide[];
  /** What is shown when the film has no screenshots. */
  fallback: ReactNode;
  expanded: boolean;
  chosen: BackdropTrailer | null;
  /** The trailer is on screen as the backdrop (so "Трейлер" can grow it instead of listing trailers). */
  onLive: (live: boolean) => void;
  onCollapse: () => void;
  /** Opens the list of the film's trailers (the page's window) to pick another one. */
  onList: () => void;
}) {
  const enabled = useApp((s) => s.backdropTrailer);
  // Settings → Плеер → «Размер кнопок»: the same scale as the other players' controls.
  const uiScale = useApp((s) => s.playerPrefs.uiScale);
  const hasNames = Boolean(film.nameRu || film.nameOriginal);
  const [found, setFound] = useState<BackdropTrailer | null>(null);
  const [broken, setBroken] = useState<BackdropTrailer | null>(null);
  const candidate = chosen ?? found;
  // A stream that would not play is dropped (the frames stay).
  const current = candidate && candidate !== broken ? candidate : null;
  const [sel, setSel] = useState(0);
  const [canPlay, setCanPlay] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [ended, setEnded] = useState(false);
  const [holdOver, setHoldOver] = useState(false);
  const [inPip, setInPip] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Where to go on and whether to play, after the quality was changed (the stream is loaded anew).
  const resumeRef = useRef<{ t: number; playing: boolean } | null>(null);
  // After a change of quality the sound comes back in a short rise, not the long one of the first time.
  const quickRise = useRef(false);

  // The first frame's moment (the same as the slideshow's own) — the trailer does not come in before it is over.
  useEffect(() => {
    setHoldOver(false);
    if (!enabled) return;
    const t = window.setTimeout(() => setHoldOver(true), FIRST_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [id, enabled]);

  // Looked for as soon as the page knows the film's name, so it is usually found by the time the hold is over.
  useEffect(() => {
    setFound(null);
    if (!enabled || !hasNames) return;
    let cancelled = false;
    void loadBackdropTrailer(id, film).then((t) => !cancelled && setFound(t));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled, hasNames]);

  // Another trailer on the element: from its beginning, in its own default quality.
  useEffect(() => {
    resumeRef.current = null;
    setCanPlay(false);
    setSwitching(false);
    setEnded(false);
    if (current) setSel(chosen ? current.fullIndex : current.index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const quality = current ? current.qualities[Math.min(sel, current.qualities.length - 1)] : null;
  const videoUrl = quality?.url ?? null;
  const audioUrl = quality?.audioUrl ?? null;

  // The stream goes onto the element: HLS (Rutube) through hls.js, anything else as it is.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoUrl || !current) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;
    const fail = () => {
      if (cancelled) return;
      setBroken(current);
      if (chosen) onCollapse();
    };
    v.addEventListener("error", fail);
    const resume = resumeRef.current;
    if (resume) v.addEventListener("loadedmetadata", () => (v.currentTime = resume.t), { once: true });
    if (/\.m3u8(\?|$)/i.test(videoUrl)) {
      void import("hls.js")
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (Hls.isSupported()) {
            const h = new Hls({ capLevelToPlayerSize: true });
            h.on(Hls.Events.ERROR, (_e, data) => data.fatal && fail());
            h.loadSource(videoUrl);
            h.attachMedia(v);
            hls = h;
          } else {
            v.src = videoUrl;
          }
        })
        .catch(fail);
    } else {
      v.src = videoUrl;
    }
    return () => {
      cancelled = true;
      v.removeEventListener("error", fail);
      hls?.destroy();
      v.removeAttribute("src");
      v.load();
    };
    // `current` too: the same address picked again must start over, not stay at the end of the last run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, current]);

  // Taking another quality loads the stream anew — from the same place, and while that goes on the picture stays.
  const selectQuality = (i: number) => {
    const v = videoRef.current;
    if (!current || !v || i === sel) return;
    resumeRef.current = { t: v.currentTime, playing: !v.paused };
    quickRise.current = true;
    setSwitching(true);
    setCanPlay(false);
    setSel(i);
  };

  // A trailer picked on purpose is not held back by the hold or the setting.
  const visible = current !== null && !ended && (chosen !== null || (enabled && holdOver)) && (canPlay || switching);
  // In the picture-in-picture window the page's own copy is empty: the frames show again.
  const shown = visible && !inPip;

  useEffect(() => {
    onLive(visible);
  }, [visible, onLive]);
  useEffect(() => () => onLive(false), [onLive]);

  // On screen = playing; not (yet, or no more) = held back, so the start of the trailer is not lost under the frame.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (visible) void v.play().catch(() => undefined);
    else v.pause();
  }, [visible]);

  // The trailer is over: back to the frames — and, if it was grown, back to the page.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const done = () => {
      setEnded(true);
      if (document.pictureInPictureElement === v) void document.exitPictureInPicture().catch(() => undefined);
      onCollapse();
    };
    v.addEventListener("ended", done);
    return () => v.removeEventListener("ended", done);
  }, [onCollapse, current]);

  // ---- picture in picture: the video goes to a small window of its own and the page is free to be browsed
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const enter = () => setInPip(true);
    const leave = () => setInPip(false);
    v.addEventListener("enterpictureinpicture", enter);
    v.addEventListener("leavepictureinpicture", leave);
    return () => {
      v.removeEventListener("enterpictureinpicture", enter);
      v.removeEventListener("leavepictureinpicture", leave);
    };
  }, [current]);
  // Grown again (the "Трейлер" button): the picture comes back from its window.
  useEffect(() => {
    const v = videoRef.current;
    if (expanded && v && document.pictureInPictureElement === v) void document.exitPictureInPicture().catch(() => undefined);
  }, [expanded]);
  const togglePip = () => {
    const v = videoRef.current;
    if (!v) return;
    if (document.pictureInPictureElement === v) {
      void document.exitPictureInPicture().catch(() => undefined);
      return;
    }
    v.requestPictureInPicture()
      .then(() => onCollapse())
      .catch((e) => console.warn("[pip]", e instanceof Error ? e.message : e));
  };

  const [fit, setFit] = useState<Fit>(() => {
    try {
      const v = localStorage.getItem(FIT_KEY);
      return (FITS as string[]).includes(v ?? "") ? (v as Fit) : "cover";
    } catch {
      return "cover";
    }
  });
  const cycleFit = () => {
    const next = FITS[(FITS.indexOf(fit) + 1) % FITS.length];
    setFit(next);
    try {
      localStorage.setItem(FIT_KEY, next);
    } catch {
      /* the shape just will not be remembered */
    }
  };

  const [volume, setVolume] = useState(readVolume);
  const [muted, setMuted] = useState(false);
  const [volShown, setVolShown] = useState(false);
  const volTimer = useRef(0);
  const changeVolume = (to: number) => {
    const v = clamp01(to);
    setVolShown(true);
    window.clearTimeout(volTimer.current);
    volTimer.current = window.setTimeout(() => setVolShown(false), 1500);
    setVolume(v);
    setMuted(false);
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch {
      /* the level just will not be remembered */
    }
  };

  // ---- the sound, only while grown (or in the small window): it comes up over a second as the page goes dark, and
  // dies away as it returns. `fade` (0..1) is that rise and fall; `audible` stays on until the fall is over.
  const fadeRef = useRef(0);
  const volumeNow = useRef(volume);
  volumeNow.current = volume;
  const [audible, setAudible] = useState(false);
  // While the stream is being changed the sound is off (the old one is gone, the new one is not there yet — what plays
  // then is a scrap of the start or a jump); it comes back with the picture, from the right place.
  const soundOn = visible && (expanded || inPip);
  const soundWanted = soundOn && !switching;
  useEffect(() => {
    const target = soundWanted ? 1 : 0;
    if (target === 1) setAudible(true);
    const from = fadeRef.current;
    if (from === target) {
      if (target === 0) setAudible(false);
      return;
    }
    const dur = target === 1 ? (quickRise.current ? 450 : 1000) : 400;
    if (target === 1) quickRise.current = false;
    const t0 = performance.now() + (target === 1 ? 150 : 0);
    const timer = window.setInterval(() => {
      const p = clamp01((performance.now() - t0) / dur);
      fadeRef.current = from + (target - from) * p;
      const level = volumeNow.current * fadeRef.current;
      if (videoRef.current) videoRef.current.volume = level;
      if (audioRef.current) audioRef.current.volume = level;
      if (p >= 1) {
        window.clearInterval(timer);
        if (target === 0) setAudible(false);
      }
    }, 40);
    return () => window.clearInterval(timer);
  }, [soundWanted]);

  // YouTube keeps the sound in a stream of its own: a second element follows the picture.
  const separateAudio = audioUrl != null;
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v) return;
    const sound = audible && !switching;
    v.muted = !sound || separateAudio || muted;
    v.volume = volume * fadeRef.current;
    if (a) {
      a.volume = volume * fadeRef.current;
      a.muted = muted;
    }
    if (!a) return;
    if (!sound) {
      a.pause();
      return;
    }
    const follow = () => {
      if (Math.abs(a.currentTime - v.currentTime) > 0.25) a.currentTime = v.currentTime;
    };
    const play = () => {
      follow();
      if (!v.paused) void a.play().catch(() => undefined);
    };
    const stop = () => a.pause();
    play();
    v.addEventListener("pause", stop);
    v.addEventListener("waiting", stop);
    v.addEventListener("playing", play);
    v.addEventListener("seeked", play);
    const timer = window.setInterval(follow, 400);
    return () => {
      window.clearInterval(timer);
      v.removeEventListener("pause", stop);
      v.removeEventListener("waiting", stop);
      v.removeEventListener("playing", play);
      v.removeEventListener("seeked", play);
      a.pause();
    };
  }, [audible, switching, audioUrl, separateAudio, volume, muted]);

  // The page's own music gives way to the trailer's sound.
  useEffect(() => (soundOn ? holdMusic() : undefined), [soundOn]);

  // ---- the bar and the keys while grown
  const [time, setTime] = useState({ at: 0, total: 0 });
  const [paused, setPaused] = useState(false);
  const [controls, setControls] = useState(true);
  const [qOpen, setQOpen] = useState(false);
  const [ui, setUiState] = useState<Ui>(IDLE_UI);
  const uiRef = useRef<Ui>(IDLE_UI);
  const setUi = (patch: Partial<Ui>) => {
    uiRef.current = { ...uiRef.current, ...patch };
    setUiState(uiRef.current);
  };
  // What the key handler needs from the latest render (it lives longer than one).
  const latest = useRef({
    items: [] as Item[],
    rows: [] as number[],
    sel: 0,
    selectQuality: (_i: number) => {},
    togglePlay: () => {},
    togglePip: () => {},
    cycleFit: () => {},
  });
  // The key handler lives as long as the grown trailer does, so it reads the level through a ref.
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const hideTimer = useRef(0);
  const touch = () => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setControls(false);
      setQOpen(false);
      setUi(IDLE_UI);
    }, CONTROLS_MS);
  };

  // The level for the phone remote's bar (while the trailer is grown).
  useEffect(() => {
    if (!expanded) return;
    document.documentElement.style.setProperty("--player-volume", String(muted ? 0 : volume));
    return () => {
      document.documentElement.style.removeProperty("--player-volume");
    };
  }, [expanded, volume, muted]);

  const togglePipRef = useRef(togglePip);
  togglePipRef.current = togglePip;
  const onListRef = useRef(onList);
  onListRef.current = onList;
  useEffect(() => {
    if (!expanded) return;
    const v = videoRef.current;
    if (!v) return;
    touch();
    const sync = () => {
      setTime({ at: v.currentTime, total: v.duration });
      setPaused(v.paused);
    };
    sync();
    v.addEventListener("timeupdate", sync);
    v.addEventListener("pause", sync);
    v.addEventListener("play", sync);
    const seekBy = (d: number) => {
      v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + d));
    };
    const key = (e: KeyboardEvent) => {
      // The page under the trailer must not move: the keys are the trailer's alone while it is grown.
      if (e.key === "Escape" || e.key === "Backspace" || e.key === "BrowserBack" || e.key === "GoBack") return;
      // A window (the list of trailers) is open over the trailer: the keys are its own.
      if (document.querySelector(".modal-panel")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const k = e.key;
      const ok = k === "Enter" || k === " ";
      if (e.repeat && ok) return;
      touch();
      const L = latest.current;
      const u = uiRef.current;
      if (k === "m" || k === "M") return setMuted((m) => !m);
      // "p" is what the phone remote's play button sends: it plays and pauses (picture in picture moved to "i").
      if (k === "p" || k === "P" || k === "MediaPlayPause") return L.togglePlay();
      if (k === "i" || k === "I") return L.togglePip();
      // The phone remote's "+" / "−".
      if (k === "AudioVolumeUp") return changeVolume(volumeRef.current + VOLUME_STEP);
      if (k === "AudioVolumeDown") return changeVolume(volumeRef.current - VOLUME_STEP);
      if (k === "MediaRewind") return seekBy(-REMOTE_SEEK_S);
      if (k === "MediaFastForward") return seekBy(REMOTE_SEEK_S);

      // a level or a list is open over a button: it takes the arrows
      if (u.popup === "vol") {
        if (k === "ArrowUp") changeVolume(volumeRef.current + VOLUME_STEP);
        else if (k === "ArrowDown") changeVolume(volumeRef.current - VOLUME_STEP);
        else if (k === "ArrowLeft" || k === "ArrowRight" || ok) setUi({ popup: null });
        return;
      }
      if (u.popup === "quality") {
        if (k === "ArrowUp") setUi({ cursor: Math.max(0, u.cursor - 1) });
        else if (k === "ArrowDown") setUi({ cursor: Math.min(L.rows.length - 1, u.cursor + 1) });
        else if (ok) {
          L.selectQuality(L.rows[u.cursor]);
          setUi({ popup: null });
        } else if (k === "ArrowLeft" || k === "ArrowRight") setUi({ popup: null });
        return;
      }
      // the time bar is held: it is moved by the arrows
      if (u.scrub) {
        if (k === "ArrowLeft") seekBy(-SEEK_S);
        else if (k === "ArrowRight") seekBy(SEEK_S);
        else if (ok || k === "ArrowUp" || k === "ArrowDown") setUi({ scrub: false });
        return;
      }
      // the bar has the focus: the arrows go from button to button
      if (u.bar) {
        // the way back (top left) and the list of trailers (top right): down returns to the bar, left/right go
        // from one to the other, OK does what the button says
        if (u.item === "back" || u.item === "list") {
          if (k === "ArrowDown") setUi({ item: "play" });
          else if (k === "ArrowRight" && u.item === "back") setUi({ item: "list" });
          else if (k === "ArrowLeft" && u.item === "list") setUi({ item: "back" });
          else if (ok) {
            if (u.item === "back") onCollapse();
            else onListRef.current();
          }
          return;
        }
        const at = Math.max(0, L.items.indexOf(u.item));
        if (k === "ArrowLeft") setUi({ item: L.items[Math.max(0, at - 1)] });
        else if (k === "ArrowRight") setUi({ item: L.items[Math.min(L.items.length - 1, at + 1)] });
        else if (k === "ArrowDown") setUi({ bar: false });
        else if (k === "ArrowUp" && u.item === "vol") setUi({ popup: "vol" });
        else if ((k === "ArrowUp" || ok) && u.item === "quality") setUi({ popup: "quality", cursor: Math.max(0, L.rows.indexOf(L.sel)) });
        else if (k === "ArrowUp") setUi({ item: "back" });
        else if (ok) {
          if (u.item === "play") L.togglePlay();
          else if (u.item === "vol") setMuted((m) => !m);
          else if (u.item === "seek") setUi({ scrub: true });
          else if (u.item === "shape") L.cycleFit();
          else if (u.item === "pip") L.togglePip();
        }
        return;
      }
      // nothing is focused: the arrows seek, OK pauses, up/down bring the bar's focus in
      if (k === "ArrowLeft") seekBy(-SEEK_S);
      else if (k === "ArrowRight") seekBy(SEEK_S);
      else if (k === "ArrowUp") setUi({ bar: true, item: "back" });
      else if (k === "ArrowDown") setUi({ bar: true, item: "play" });
      else if (ok) L.togglePlay();
    };
    window.addEventListener("keydown", key, true);
    // Back lets go of the innermost thing first: a list, the held bar, the focus; only then the trailer.
    const unback = onBack(() => {
      const u = uiRef.current;
      if (u.popup) setUi({ popup: null });
      else if (u.scrub) setUi({ scrub: false });
      else if (u.bar) setUi({ bar: false });
      else onCollapse();
      return true;
    });
    return () => {
      window.removeEventListener("keydown", key, true);
      v.removeEventListener("timeupdate", sync);
      v.removeEventListener("pause", sync);
      v.removeEventListener("play", sync);
      window.clearTimeout(hideTimer.current);
      unback();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, onCollapse, current]);

  useEffect(() => {
    if (!expanded) setUi(IDLE_UI);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // The bar and the button are kept for a moment after the way back starts, so they fade rather than vanish.
  const live = expanded && visible;
  const [overlay, setOverlay] = useState<"off" | "on" | "leaving">("off");
  useEffect(() => {
    if (live) {
      setOverlay("on");
      return;
    }
    setOverlay((o) => (o === "on" ? "leaving" : o));
    const t = window.setTimeout(() => setOverlay("off"), 340);
    return () => window.clearTimeout(t);
  }, [live]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    touch();
    if (v.paused) void v.play();
    else v.pause();
  };

  // A bar the mouse can take hold of: press and drag set the place along it.
  const along = (e: React.PointerEvent<HTMLElement>, vertical: boolean) => {
    const r = e.currentTarget.getBoundingClientRect();
    return vertical ? clamp01(1 - (e.clientY - r.top) / r.height) : clamp01((e.clientX - r.left) / r.width);
  };
  const drag = (apply: (fraction: number) => void, vertical = false) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      touch();
      apply(along(e, vertical));
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) apply(along(e, vertical));
    },
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  });
  const seekTo = (fraction: number) => {
    const v = videoRef.current;
    if (v && Number.isFinite(v.duration)) {
      v.currentTime = fraction * v.duration;
      setTime({ at: v.currentTime, total: v.duration });
    }
  };

  // Sharpest first in the list.
  const choices = current ? current.qualities.map((q, i) => ({ q, i })).reverse() : [];
  const items: Item[] = ["play", "vol", "seek"];
  if (current && current.qualities.length > 1) items.push("quality");
  items.push("shape");
  if (pipSupported()) items.push("pip");
  latest.current = { items, rows: choices.map((c) => c.i), sel, selectQuality, togglePlay, togglePip, cycleFit };
  const focused = (i: Item) => (ui.bar && ui.item === i ? "is-focus" : "");

  return (
    <>
      {slides.length > 0 ? <MovieSlides slides={slides} paused={shown} /> : fallback}
      {current && (
        <div className={`mtv__bgvideo ${shown ? "is-on" : ""}`} aria-hidden="true">
          <video
            ref={videoRef}
            style={{ objectFit: expanded ? fit : "cover" }}
            muted
            playsInline
            preload="auto"
            onCanPlay={() => {
              setCanPlay(true);
              const resume = resumeRef.current;
              if (resume) {
                resumeRef.current = null;
                setSwitching(false);
                if (resume.playing) void videoRef.current?.play().catch(() => undefined);
              }
            }}
          />
        </div>
      )}
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}
      {overlay !== "off" && (
        <div
          // A dialog for the page's own key handlers (the shelves' up/down, the "Up to the menu"): they stand aside
          // while one is open, and the arrows are the trailer's.
          role="dialog"
          aria-label="Трейлер"
          style={{ "--osd-scale": uiScale } as React.CSSProperties}
          className={`mtv__tcontrols ${controls ? "is-shown" : ""} ${overlay === "leaving" ? "is-leaving" : ""}`}
          onMouseMove={touch}
          onClick={togglePlay}
          onWheel={(e) => {
            touch();
            changeVolume(volume + (e.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP));
          }}
        >
          <PlayFlash status={paused ? "paused" : "playing"} />
          <button
            type="button"
            className={`mtv__tclose ${focused("back")}`}
            aria-label="Назад"
            onClick={(e) => {
              e.stopPropagation();
              onCollapse();
            }}
          >
            <BackIcon size={24} />
          </button>
          <button
            type="button"
            className={`mtv__tclose mtv__tlist ${focused("list")}`}
            aria-label="Трейлеры"
            onClick={(e) => {
              e.stopPropagation();
              onList();
            }}
          >
            <EpisodesIcon size={24} />
          </button>
          <div className="mtv__tbar" onClick={(e) => e.stopPropagation()}>
            <button type="button" className={`mtv__tbtn ${focused("play")}`} aria-label={paused ? "Играть" : "Пауза"} onClick={togglePlay}>
              {paused ? <PlayIcon size={26} /> : <PauseIcon size={26} />}
            </button>
            <div className={`mtv__tvol ${volShown || ui.popup === "vol" ? "is-shown" : ""}`}>
              <button
                type="button"
                className={`mtv__tbtn ${focused("vol")}`}
                aria-label="Звук"
                onClick={() => {
                  touch();
                  setMuted((m) => !m);
                }}
              >
                {muted || volume === 0 ? <MuteIcon size={24} /> : <VolumeIcon size={24} />}
              </button>
              {/* The level comes up above the icon when it is pointed at, and stands as long as it is held. */}
              <div className="mtv__tvpop">
                <div className="mtv__tslider mtv__tslider--vol" {...drag(changeVolume, true)}>
                  <div className="mtv__ttrack mtv__ttrack--vol">
                    <div className="mtv__tfill" style={{ height: `${(muted ? 0 : volume) * 100}%` }} />
                  </div>
                </div>
              </div>
            </div>
            <div className={`mtv__tslider mtv__tslider--seek ${focused("seek")} ${ui.scrub ? "is-scrub" : ""}`} {...drag(seekTo)}>
              <div className="mtv__ttrack">
                <div className="mtv__tfill" style={{ width: `${time.total > 0 ? Math.min(100, (time.at / time.total) * 100) : 0}%` }} />
              </div>
            </div>
            <span className="mtv__ttime">
              {clock(time.at)} / {clock(time.total)}
            </span>
            {current && current.qualities.length > 1 && (
              <div className={`mtv__tq ${qOpen || ui.popup === "quality" ? "is-open" : ""}`}>
                <button
                  type="button"
                  className={`mtv__tbtn ${focused("quality")}`}
                  aria-label="Качество"
                  onClick={() => {
                    touch();
                    setQOpen((o) => !o);
                  }}
                >
                  <GearIcon size={24} />
                </button>
                <div className="mtv__tmenu">
                  <div className="mtv__tmenu-title">Качество</div>
                  {choices.map(({ q, i }, row) => (
                    <button
                      key={i}
                      type="button"
                      className={`mtv__tqrow ${i === sel ? "is-current" : ""} ${ui.popup === "quality" && ui.cursor === row ? "is-cursor" : ""}`}
                      onClick={() => {
                        touch();
                        selectQuality(i);
                        setQOpen(false);
                      }}
                    >
                      <span>{q.height}p</span>
                      {i === sel && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button type="button" className={`mtv__tbtn ${focused("shape")}`} aria-label={`Картинка: ${FIT_LABELS[fit]}`} title={FIT_LABELS[fit]} onClick={cycleFit}>
              <ExpandIcon size={24} />
            </button>
            {pipSupported() && (
              <button type="button" className={`mtv__tbtn ${focused("pip")}`} aria-label="Картинка в картинке" onClick={togglePip}>
                <MiniPlayerIcon size={24} />
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
