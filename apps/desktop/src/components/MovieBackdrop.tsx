import { useEffect, useRef, useState, type ReactNode } from "react";
import { MuteIcon, onBack, PauseIcon, PlayIcon, VolumeIcon } from "@kinonyx/ui";
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
  const boxRef = useRef<HTMLDivElement>(null);
  // The window's size, for placing a picture that has black bars burnt in so that the bars fall outside it.
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [ratio, setRatio] = useState(16 / 9);
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

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [trailer]);

  // Without bars the picture just covers the window; with them, the frame is made larger and moved so that the
  // part with the picture covers it and the bars are cut off by the window's edge.
  const bars = trailer?.bars ?? null;
  const frameStyle = (() => {
    if (!bars || box.w === 0 || box.h === 0) return undefined;
    const c = 1 - bars.top - bars.bottom; // part of the frame's height that is picture
    const windowRatio = box.w / box.h;
    const pictureRatio = ratio / c;
    const fh = pictureRatio >= windowRatio ? box.h / c : box.w / ratio;
    const fw = fh * ratio;
    return {
      position: "absolute" as const,
      width: fw,
      height: fh,
      left: (box.w - fw) / 2,
      top: (box.h - c * fh) / 2 - bars.top * fh,
    };
  })();

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

  const [volume, setVolume] = useState(readVolume);
  const [muted, setMuted] = useState(false);
  const changeVolume = (to: number) => {
    const v = clamp01(to);
    setVolume(v);
    setMuted(false);
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch {
      /* the level just will not be remembered */
    }
  };

  // ---- the sound, only while grown. YouTube keeps it in a stream of its own: a second element follows the picture.
  const separateAudio = trailer?.audioUrl != null;
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v) return;
    const sound = expanded && visible;
    v.muted = !sound || separateAudio || muted;
    v.volume = volume;
    if (a) {
      a.volume = volume;
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
  }, [expanded, visible, separateAudio, volume, muted]);

  // The page's own music gives way to the trailer's sound.
  useEffect(() => (expanded && visible ? holdMusic() : undefined), [expanded, visible]);

  // ---- the bar and the keys while grown
  const [time, setTime] = useState({ at: 0, total: 0 });
  const [paused, setPaused] = useState(false);
  const [controls, setControls] = useState(true);
  // The key handler lives as long as the grown trailer does, so it reads the level through a ref.
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
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
      if (e.key === "ArrowUp") changeVolume(volumeRef.current + VOLUME_STEP);
      else if (e.key === "ArrowDown") changeVolume(volumeRef.current - VOLUME_STEP);
      else if (e.key === "m" || e.key === "M") setMuted((m) => !m);
      else if (e.key === "ArrowLeft") v.currentTime = Math.max(0, v.currentTime - SEEK_S);
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

  // A bar the mouse can take hold of: press and drag set the place along it.
  const along = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return clamp01((e.clientX - r.left) / r.width);
  };
  const drag = (apply: (fraction: number) => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      touch();
      apply(along(e));
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) apply(along(e));
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

  return (
    <>
      {slides.length > 0 ? <MovieSlides slides={slides} paused={visible} /> : fallback}
      {trailer && (
        <div ref={boxRef} className={`mtv__bgvideo ${visible ? "is-on" : ""}`} aria-hidden="true">
          <video
            ref={videoRef}
            style={frameStyle}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              const { videoWidth: w, videoHeight: h } = e.currentTarget;
              if (w > 0 && h > 0) setRatio(w / h);
            }}
            onCanPlay={() => setCanPlay(true)}
          />
        </div>
      )}
      {trailer?.audioUrl && <audio ref={audioRef} src={trailer.audioUrl} preload="auto" />}
      {expanded && visible && (
        <div
          className={`mtv__tcontrols ${controls ? "is-shown" : ""}`}
          onMouseMove={touch}
          onClick={togglePlay}
          onWheel={(e) => {
            touch();
            changeVolume(volume + (e.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP));
          }}
        >
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
          <div className="mtv__tbar" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="mtv__tbtn" aria-label={paused ? "Играть" : "Пауза"} onClick={togglePlay}>
              {paused ? <PlayIcon size={26} /> : <PauseIcon size={26} />}
            </button>
            <div className="mtv__tvol">
              <button
                type="button"
                className="mtv__tbtn"
                aria-label="Звук"
                onClick={() => {
                  touch();
                  setMuted((m) => !m);
                }}
              >
                {muted || volume === 0 ? <MuteIcon size={24} /> : <VolumeIcon size={24} />}
              </button>
              <div className="mtv__tslider" {...drag(changeVolume)}>
                <div className="mtv__ttrack mtv__ttrack--vol">
                  <div className="mtv__tfill" style={{ width: `${(muted ? 0 : volume) * 100}%` }} />
                </div>
              </div>
            </div>
            <div className="mtv__tslider mtv__tslider--seek" {...drag(seekTo)}>
              <div className="mtv__ttrack">
                <div className="mtv__tfill" style={{ width: `${time.total > 0 ? Math.min(100, (time.at / time.total) * 100) : 0}%` }} />
              </div>
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
