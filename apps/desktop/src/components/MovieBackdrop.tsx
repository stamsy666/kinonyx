import { useEffect, useRef, useState, type ReactNode } from "react";
import { onBack } from "@kinonyx/ui";
import { loadBackdropTrailer, type BackdropTrailer } from "../data/backdropTrailer";
import { holdMusic } from "../data/music";
import { useApp } from "../store/app";
import { FIRST_HOLD_MS, MovieSlides, type Slide } from "./MovieSlides";

interface FilmNames {
  nameRu?: string;
  nameOriginal?: string;
  year?: string | number;
}

const SEEK_S = 10;
/** How long the bar and the buttons stay after the last touch of the remote or the mouse. */
const CONTROLS_MS = 3500;

const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

/**
 * The film page's backdrop. The first frame stands still as before; then, if the film has a trailer that was
 * found by then, it melts in over the frames and plays without sound (the screenshots wait under it, and
 * come back when it is over). `expanded` — the viewer pressed "Трейлер": the page's text goes away elsewhere,
 * here the sound comes on and a thin bar appears; Back (or the end of the trailer) gives the page back.
 */
export function MovieBackdrop({
  id,
  film,
  slides,
  fallback,
  expanded,
  onLive,
  onCollapse,
}: {
  id: number;
  film: FilmNames;
  slides: Slide[];
  /** What is shown when the film has no screenshots. */
  fallback: ReactNode;
  expanded: boolean;
  /** The trailer is on screen as the backdrop (so "Трейлер" can grow it instead of listing trailers). */
  onLive: (live: boolean) => void;
  onCollapse: () => void;
}) {
  const enabled = useApp((s) => s.backdropTrailer);
  const hasNames = Boolean(film.nameRu || film.nameOriginal);
  const [trailer, setTrailer] = useState<BackdropTrailer | null>(null);
  const [canPlay, setCanPlay] = useState(false);
  const [ended, setEnded] = useState(false);
  const [holdOver, setHoldOver] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // The first frame's moment (the same as the slideshow's own) — the trailer does not come in before it is over.
  useEffect(() => {
    setHoldOver(false);
    if (!enabled) return;
    const t = window.setTimeout(() => setHoldOver(true), FIRST_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [id, enabled]);

  // Looked for as soon as the page knows the film's name, so it is usually found by the time the hold is over.
  useEffect(() => {
    setTrailer(null);
    setCanPlay(false);
    setEnded(false);
    if (!enabled || !hasNames) return;
    let cancelled = false;
    void loadBackdropTrailer(id, film).then((t) => !cancelled && setTrailer(t));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled, hasNames]);

  // The stream goes onto the element: HLS (Rutube) through hls.js, anything else as it is.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !trailer) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;
    const fail = () => !cancelled && setTrailer(null);
    v.addEventListener("error", fail);
    if (/\.m3u8(\?|$)/i.test(trailer.url)) {
      void import("hls.js")
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (Hls.isSupported()) {
            const h = new Hls({ capLevelToPlayerSize: true });
            h.on(Hls.Events.ERROR, (_e, data) => data.fatal && fail());
            h.loadSource(trailer.url);
            h.attachMedia(v);
            hls = h;
          } else {
            v.src = trailer.url;
          }
        })
        .catch(fail);
    } else {
      v.src = trailer.url;
    }
    return () => {
      cancelled = true;
      v.removeEventListener("error", fail);
      hls?.destroy();
      v.removeAttribute("src");
      v.load();
    };
  }, [trailer]);

  const visible = enabled && holdOver && canPlay && !ended && trailer !== null;

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
      onCollapse();
    };
    v.addEventListener("ended", done);
    return () => v.removeEventListener("ended", done);
  }, [onCollapse, trailer]);

  // ---- the sound, only while grown. YouTube keeps it in a stream of its own: a second element follows the picture.
  const separateAudio = trailer?.audioUrl != null;
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v) return;
    const sound = expanded && visible;
    v.muted = !sound || separateAudio;
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
  }, [expanded, visible, separateAudio]);

  // The page's own music gives way to the trailer's sound.
  useEffect(() => (expanded && visible ? holdMusic() : undefined), [expanded, visible]);

  // ---- the bar and the keys while grown
  const [time, setTime] = useState({ at: 0, total: 0 });
  const [paused, setPaused] = useState(false);
  const [controls, setControls] = useState(true);
  const hideTimer = useRef(0);
  const touch = () => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControls(false), CONTROLS_MS);
  };

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
    const key = (e: KeyboardEvent) => {
      // The page under the trailer must not move: the keys are the trailer's alone while it is grown.
      if (e.key === "Escape" || e.key === "Backspace" || e.key === "BrowserBack" || e.key === "GoBack") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat && (e.key === "Enter" || e.key === " ")) return;
      touch();
      if (e.key === "ArrowLeft") v.currentTime = Math.max(0, v.currentTime - SEEK_S);
      else if (e.key === "ArrowRight") v.currentTime = Math.min(v.duration || Infinity, v.currentTime + SEEK_S);
      else if (e.key === "Enter" || e.key === " ") {
        if (v.paused) void v.play();
        else v.pause();
      }
    };
    window.addEventListener("keydown", key, true);
    const unback = onBack(() => (onCollapse(), true));
    return () => {
      window.removeEventListener("keydown", key, true);
      v.removeEventListener("timeupdate", sync);
      v.removeEventListener("pause", sync);
      v.removeEventListener("play", sync);
      window.clearTimeout(hideTimer.current);
      unback();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, onCollapse]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    touch();
    if (v.paused) void v.play();
    else v.pause();
  };

  return (
    <>
      {slides.length > 0 ? <MovieSlides slides={slides} paused={visible} /> : fallback}
      {trailer && (
        <div className={`mtv__bgvideo ${visible ? "is-on" : ""}`} aria-hidden="true">
          <video ref={videoRef} muted playsInline preload="auto" onCanPlay={() => setCanPlay(true)} />
        </div>
      )}
      {trailer?.audioUrl && <audio ref={audioRef} src={trailer.audioUrl} preload="auto" />}
      {expanded && visible && (
        <div className={`mtv__tcontrols ${controls ? "is-shown" : ""}`} onMouseMove={touch} onClick={togglePlay}>
          <button
            type="button"
            className="mtv__tclose"
            onClick={(e) => {
              e.stopPropagation();
              onCollapse();
            }}
          >
            Назад
          </button>
          <div className="mtv__tbar">
            <span className="mtv__tstate">{paused ? "Пауза" : ""}</span>
            <div className="mtv__ttrack">
              <div className="mtv__tfill" style={{ width: `${time.total > 0 ? Math.min(100, (time.at / time.total) * 100) : 0}%` }} />
            </div>
            <span className="mtv__ttime">
              {clock(time.at)} / {clock(time.total)}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
