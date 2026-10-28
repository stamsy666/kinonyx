import { useEffect, useMemo, useRef, useState } from "react";
import { logEvent } from "../data/log";
import { getTrackPrefs, matchTrack, rememberTrack } from "../store/trackPrefs";
import { getLearnedIntro, learnIntro } from "../store/introPrefs";
import { findSkip, learnFromJump } from "../data/skipSegments";
import { buildExtraTracks } from "../data/extraTracks";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import {
  Html5Adapter,
  INITIAL_STATE,
  MpvAdapter,
  type PlayerAdapter,
  type PlayerState,
  type PlayerStats,
  type PlaySource,
  type TrackKind,
  type ExtraTrack,
} from "@kinonyx/player-core";
import {
  BackIcon,
  EpisodesIcon,
  Focusable,
  FocusGroup,
  ForwardIcon,
  GearIcon,
  MiniPlayerIcon,
  PlayerSettingsIcon,
  MuteIcon,
  NextEpisodeIcon,
  OfflineIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  Spinner,
  SubtitlesIcon,
  TracksIcon,
  VolumeIcon,
  onBack,
} from "@kinonyx/ui";
import { useApp } from "../store/app";
import { PicturePanel } from "../components/PicturePanel";
import { useTranslator } from "../store/translator";
import { translatorRelease } from "../data/translator";
import { LiveSubtitles, useFilmTranslation } from "../components/LiveSubtitles";
import { useContinueWatching } from "../store/continueWatching";
import { isTauri } from "../data/io";
import { episodeKey, episodeLabel } from "../data/episodes";
import { buildMpvOptions } from "../data/playerOptions";
import { trackLabel } from "../data/trackLabel";
import { useWatchTracker } from "../components/useWatchTracker";
import { usePresence } from "../components/usePresence";
import { useEpisodeProgress } from "../store/episodeProgress";
import { streamUrlFor, torrentSwarmStats, type SwarmStats, type TorrentFile, type TrailerQuality } from "../data/api";
import { SeekBar } from "../components/SeekBar";
import { PlayFlash } from "../components/PlayFlash";
import { useMpvReveal } from "../components/useMpvReveal";
import { Modal } from "../components/Modal";
import { VolumeSlider } from "../components/VolumeSlider";
import { FullscreenButton } from "../components/FullscreenButton";
import { MiniPlayerChrome, useCloseOnOutsidePress } from "../components/MiniPlayer";

const SEEK_STEP = 15;

function fmt(sec: number) {
  if (!Number.isFinite(sec)) return "--:--";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

interface EpisodeQueue {
  hash: string;
  files: TorrentFile[];
  index: number;
  /** Every file of the release (the subtitles and sound tracks of the next episode are looked for in them). */
  all?: TorrentFile[];
}

/** Hosts that check the request's Referer usually check the User-Agent too. */
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function PlayerScreen({
  title,
  url,
  qualities,
  qualityIndex,
  hash,
  filmId,
  film,
  poster,
  episodes,
  extras,
  referer,
  mini = false,
}: {
  /** The page the stream belongs to, for hosts that refuse a request without it (sent as Referer, with a browser User-Agent). */
  referer?: string;
  /** Minimised to a corner: only the small window is drawn, no keys or Back are taken. */
  mini?: boolean;
  title: string;
  url: string;
  qualities?: TrailerQuality[];
  qualityIndex?: number;
  hash?: string;
  filmId?: number;
  film?: { nameRu?: string; nameOriginal?: string; year?: string | number; genres?: string[] };
  poster?: string;
  episodes?: EpisodeQueue;
  /** Subtitles and sound tracks that came in the release beside the video. */
  extras?: ExtraTrack[];
}) {
  const back = useApp((s) => s.back);
  const replace = useApp((s) => s.replace);
  const minimize = useApp((s) => s.minimize);
  const expandPlayer = useApp((s) => s.expandPlayer);
  const closePlayer = useApp((s) => s.closePlayer);
  const showStreamStats = useApp((s) => s.showStreamStats);
  const playerDim = useApp((s) => s.playerDim);
  const prefs = useApp((s) => s.playerPrefs);
  const [swarm, setSwarm] = useState<SwarmStats | null>(null);

  // Download speed vs. bitrate is THE number that explains buffering on a torrent
  // stream — polled only while the stats overlay is on.
  useEffect(() => {
    if (!hash || !showStreamStats) return;
    let stopped = false;
    const tick = () =>
      torrentSwarmStats(hash)
        .then((s) => !stopped && setSwarm(s))
        .catch(() => undefined);
    void tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [hash, showStreamStats]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const adapterRef = useRef<PlayerAdapter | null>(null);
  const [state, setState] = useState<PlayerState>(INITIAL_STATE);
  const [osd, setOsd] = useState(true);
  const [menu, setMenu] = useState<TrackKind | null>(null);
  const [volumeOpen, setVolumeOpen] = useState(false);
  // The level comes up when the mouse is on the volume button (and goes when it leaves); the remote opens it with OK
  // and then holds the focus in it. Only the second takes the focus.
  const [volumeByMouse, setVolumeByMouse] = useState(false);
  const volumeLeave = useRef(0);
  const nudgeVolumeRef = useRef<(d: number) => void>(() => {});
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [pictureOpen, setPictureOpen] = useState(false);

  const hideTimer = useRef<number>(0);

  // Trailers come with a list of qualities; switching one reloads the stream and resumes
  // from where it was (mpv's per-title `start` option).
  const [qIdx, setQIdx] = useState(qualityIndex ?? 0);
  const [resumeAt, setResumeAt] = useState(0);
  const quality = qualities?.[qIdx];
  const curUrl = quality?.url ?? url;
  const curAudio = quality?.audioUrl ?? undefined;
  const source: PlaySource = useMemo(() => {
    const mpvOptions: Record<string, string> = {};
    if (curAudio) mpvOptions["audio-files"] = curAudio;
    if (resumeAt > 1) mpvOptions.start = String(Math.floor(resumeAt));
    // The player settings (subtitles, night mode, scaling, HDR…) are mpv options set before each load.
    Object.assign(mpvOptions, buildMpvOptions(prefs));
    return {
      url: curUrl,
      title,
      live: false,
      mpvOptions,
      extraTracks: extras,
      ...(referer ? { headers: { Referer: referer }, userAgent: BROWSER_UA } : {}),
    };
  }, [curUrl, curAudio, title, resumeAt, prefs, extras, referer]);

  // Local translation of the film's speech into Russian subtitles (torrent films only; same
  // engine as the channels' translator). Off for every new film.
  const translatorReady = useTranslator((s) => s.ready());
  const translationEnabled = useTranslator((s) => s.translationEnabled());
  const refreshTranslator = useTranslator((s) => s.refresh);
  useEffect(() => {
    void refreshTranslator();
  }, [refreshTranslator]);
  const [filmTr, setFilmTr] = useState(false);
  const [trHint, setTrHint] = useState<string | null>(null);
  const canTranslate = isTauri && !!hash && translationEnabled;
  const filmSubs = useFilmTranslation(canTranslate ? curUrl : null, filmTr, state.position);
  useEffect(() => {
    if (filmSubs.state !== "error") return;
    setTrHint(`Перевод выключен: ${filmSubs.error ?? "ошибка"}`);
    setFilmTr(false);
    void translatorRelease("all").catch(() => undefined);
  }, [filmSubs.state, filmSubs.error]);
  useEffect(() => {
    if (!trHint) return;
    const t = window.setTimeout(() => setTrHint(null), 9000);
    return () => window.clearTimeout(t);
  }, [trHint]);
  // A new film or episode starts without translation (it costs the video card's time).
  useEffect(() => {
    setFilmTr(false);
  }, [curUrl]);
  const turnTranslationOff = () => {
    if (!filmTr) return;
    setFilmTr(false);
    void translatorRelease("all").catch(() => undefined);
  };
  // Leaving the player with the translation on: its engines go too (not for a player that never used it).
  const filmTrRef = useRef(false);
  filmTrRef.current = filmTr;
  useEffect(
    () => () => {
      if (filmTrRef.current) void translatorRelease("all").catch(() => undefined);
    },
    [],
  );

  const bump = () => {
    setOsd(true);
    window.clearTimeout(hideTimer.current);
    // 0 = "don't hide": the controls stay until the viewer leaves the player.
    if (prefs.autoHideSec <= 0) return;
    hideTimer.current = window.setTimeout(() => {
      setOsd(false);
      setMenu(null);
      setVolumeOpen(false);
    }, prefs.autoHideSec * 1000);
  };

  const revealed = useMpvReveal(state.status, source);
  // The log: a player that stops on an error, and what it was playing (the host only — links carry tokens).
  useEffect(() => {
    if (state.status !== "error") return;
    let host = "";
    try {
      host = new URL(source.url).host;
    } catch {
      /* a local path or something that isn't a URL */
    }
    logEvent("error", "player", `${state.error ?? "error"} (${host || "no url"})`);
  }, [state.status, state.error, source.url]);

  // The sound track and subtitles picked earlier for this film or series come back by themselves: the tracks of
  // a new file (the next episode, another release) are matched by language and name, once per loaded file.
  const tracksAppliedFor = useRef("");
  useEffect(() => {
    if (!filmId || state.tracks.length === 0 || tracksAppliedFor.current === source.url) return;
    const saved = getTrackPrefs(filmId);
    tracksAppliedFor.current = source.url;
    if (!saved) return;
    const a = adapterRef.current;
    if (!a) return;
    const audio = saved.audio && matchTrack(state.tracks.filter((t) => t.kind === "audio"), saved.audio);
    if (audio && !audio.selected) void a.selectTrack("audio", audio.id);
    if (saved.subtitle === "off") {
      if (state.tracks.some((t) => t.kind === "subtitle" && t.selected)) void a.selectTrack("subtitle", null);
    } else if (saved.subtitle) {
      const sub = matchTrack(state.tracks.filter((t) => t.kind === "subtitle"), saved.subtitle);
      if (sub && !sub.selected) void a.selectTrack("subtitle", sub.id);
    }
  }, [filmId, source.url, state.tracks]);
  // A press on the picture (anywhere outside the volume control) closes the volume slider.
  useCloseOnOutsidePress(volumeOpen, () => setVolumeOpen(false));

  // Episode of a series pack being played — progress is kept per episode (see store/episodeProgress.ts).
  const epKey = episodes ? episodeKey(episodes.files[episodes.index]) : null;

  // "Skip intro": the file's own chapter marks first; in a series, also the stretch the viewer jumped over in an
  // earlier episode (learned from their own seeking, nothing to mark by hand).
  const learnedIntro = useMemo(() => (filmId && episodes ? getLearnedIntro(filmId) : undefined), [filmId, episodes, source.url]);
  const hasNextEpisode = !!episodes && episodes.index < episodes.files.length - 1;
  const rawSkip =
    !filmId || state.status === "error" || prefs.skipMode === "off"
      ? null
      : findSkip({ chapters: state.chapters, learned: learnedIntro, position: state.position, duration: state.duration, series: !!episodes, hasNext: hasNextEpisode });
  // Before the stretch it is only announced; the button is pressable inside it.
  const skipTarget = rawSkip && rawSkip.phase === "inside" && prefs.skipMode === "button" ? rawSkip : null;
  const skipAnnounce = rawSkip && (rawSkip.phase === "preview" || prefs.skipMode === "auto") ? rawSkip : null;
  const lastTick = useRef({ pos: -1, at: 0 });
  const skippedByButton = useRef(false);
  useEffect(() => {
    const now = performance.now();
    const prev = lastTick.current;
    lastTick.current = { pos: state.position, at: now };
    if (!filmId || !episodes || state.status !== "playing") return;
    // A real forward jump during playback — not the first position after a resume or a new file (prev ≤ 3 s).
    if (skippedByButton.current) {
      skippedByButton.current = false;
      return;
    }
    if (prev.pos > 3 && now - prev.at < 5000) {
      const jump = learnFromJump(prev.pos, state.position);
      if (jump) learnIntro(filmId, jump);
    }
  }, [state.position, state.status, filmId, episodes]);
  const skipNow = (target = skipTarget) => {
    if (!target) return;
    skippedByButton.current = true;
    // The credits at the end of an episode of a series go to the next episode; everything else is a seek.
    if (target.toNext) goToNextEpisode();
    else void adapterRef.current?.seek(target.to);
  };
  // "Сам": the stretch is jumped over the moment it begins (once for each).
  const autoSkipped = useRef("");
  useEffect(() => {
    if (prefs.skipMode !== "auto" || !rawSkip || rawSkip.phase !== "inside") return;
    const id = `${source.url}:${rawSkip.kind}:${rawSkip.from}`;
    if (autoSkipped.current === id) return;
    autoSkipped.current = id;
    skipNow(rawSkip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawSkip?.phase, rawSkip?.kind, rawSkip?.from, prefs.skipMode]);
  const skipShown = useRef(false);
  useEffect(() => {
    // Appears under the viewer's thumb: focus goes to it so that OK skips (as in the streaming apps).
    if (skipTarget && !skipShown.current && !menu) {
      skipShown.current = true;
      window.setTimeout(() => setFocus("player:skip"), 50);
    }
    if (!skipTarget) skipShown.current = false;
  }, [skipTarget, menu]);

  // Discord status: the film (and episode) being watched. Trailers show as such.
  usePresence(
    {
      details: film?.nameRu || film?.nameOriginal || title,
      state: filmId ? (epKey ? episodeLabel(epKey, "сериал") : "фильм") : "трейлер",
    },
    state.status === "playing",
    state.position,
  );

  // Viewing statistics: time spent playing a film/episode (trailers aren't counted).
  useWatchTracker(
    state.status === "playing",
    filmId
      ? { key: `m:${filmId}`, title: film?.nameRu || film?.nameOriginal || title, poster, kind: episodes ? "series" : "movie", filmId, genres: film?.genres }
      : null,
  );

  // "Continue watching" — only for a genuine movie/episode watch (filmId set, never a
  // trailer). Resume-seek happens once per mount, the moment the real duration is known
  // (not the INITIAL_STATE placeholder); position is then reported throttled to at most
  // once every 10s (state.position itself ticks ~1/s from the adapter) plus a final
  // report on unmount/episode-change so closing mid-way doesn't lose the last few seconds.
  const resumedRef = useRef(false);
  useEffect(() => {
    resumedRef.current = false;
  }, [source]);

  useEffect(() => {
    if (!filmId || resumedRef.current) return;
    if (!Number.isFinite(state.duration) || state.duration <= 0) return;
    resumedRef.current = true;
    // A series resumes each episode from its own position, not from whichever episode
    // happened to be watched last.
    const saved = epKey
      ? useEpisodeProgress.getState().resumeAt(filmId, epKey)
      : useContinueWatching.getState().positionFor(filmId);
    if (saved && saved < state.duration - 5) void adapterRef.current?.seek(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmId, state.duration]);

  const lastReportRef = useRef(0);
  useEffect(() => {
    if (!filmId) return;
    const now = Date.now();
    if (now - lastReportRef.current < 10_000) return;
    lastReportRef.current = now;
    useContinueWatching.getState().report({ filmId, title, poster, film, position: state.position, duration: state.duration });
    if (epKey) useEpisodeProgress.getState().report(filmId, epKey, title, state.position, state.duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmId, title, poster, film, state.position, state.duration]);

  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (!filmId) return;
    return () => {
      const s = stateRef.current;
      useContinueWatching.getState().report({ filmId, title, poster, film, position: s.position, duration: s.duration });
      if (epKey) useEpisodeProgress.getState().report(filmId, epKey, title, s.position, s.duration);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmId, title, poster, film]);

  const nextEpisode = episodes && episodes.index < episodes.files.length - 1 ? episodes.files[episodes.index + 1] : undefined;
  // Switching episodes stays inside the same "watch session" — `replace` swaps the
  // screen in place instead of pushing a new history entry, so Back always exits
  // straight to wherever the player was opened from (the movie page), no matter how
  // many episodes were played in between. Previously this used `navigate`, which piled
  // up one history entry per episode — Back had to be pressed once per episode watched
  // before it would actually leave the player, rewinding all the way to episode 1.
  const goToEpisode = async (index: number) => {
    if (!episodes) return;
    const file = episodes.files[index];
    if (!file) return;
    setEpisodesOpen(false);
    const nextUrl = await streamUrlFor(episodes.hash, file);
    const nextExtras = episodes.all?.length ? await buildExtraTracks(episodes.hash, episodes.all, file, episodes.files) : [];
    replace({
      name: "player",
      title: file.name,
      url: nextUrl,
      hash: episodes.hash,
      filmId,
      film,
      poster,
      episodes: { hash: episodes.hash, files: episodes.files, index, all: episodes.all },
      extras: nextExtras,
    });
  };
  const goToNextEpisode = () => void goToEpisode(episodes ? episodes.index + 1 : 0);

  // When an episode ends, the next one starts by itself after a short countdown (cancellable).
  const AUTO_NEXT_SECS = 8;
  const [autoNext, setAutoNext] = useState<number | null>(null);
  const autoNextCancelled = useRef(false);
  useEffect(() => {
    autoNextCancelled.current = false;
    setAutoNext(null);
  }, [episodes?.index]);
  useEffect(() => {
    if (state.status !== "ended") return;
    if (filmId && epKey) useEpisodeProgress.getState().markWatched(filmId, epKey);
    if (nextEpisode && !autoNextCancelled.current) setAutoNext(AUTO_NEXT_SECS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);
  useEffect(() => {
    if (autoNext === null) return;
    if (autoNext <= 0) {
      setAutoNext(null);
      goToNextEpisode();
      return;
    }
    const t = window.setTimeout(() => setAutoNext((n) => (n === null ? null : n - 1)), 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoNext]);

  useEffect(() => {
    const adapter = isTauri ? new MpvAdapter() : videoRef.current ? new Html5Adapter(videoRef.current) : null;
    if (!adapter) return;
    adapterRef.current = adapter;
    const unsub = adapter.subscribe(setState);
    return () => {
      unsub();
      adapter.destroy();
      adapterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!adapterRef.current) return;
    void adapterRef.current.load(source);
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => {
    if (mini) return; // a minimised player does not take Back
    return onBack(() => {
      if (volumeOpen) {
        setVolumeOpen(false);
        bump();
        return true;
      }
      if (menu) {
        setMenu(null);
        bump();
        return true;
      }
      if (episodesOpen) {
        setEpisodesOpen(false);
        bump();
        return true;
      }
      if (pictureOpen) {
        setPictureOpen(false);
        bump();
        return true;
      }
      if (qualityOpen) {
        setQualityOpen(false);
        bump();
        return true;
      }
      if (!osd) {
        bump();
        return true;
      }
      back();
      return true;
    });
  }, [volumeOpen, menu, episodesOpen, qualityOpen, pictureOpen, osd, back, mini]);

  useEffect(() => {
    if (mini) return; // …and does not swallow the keys of the screen the viewer is on
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Backspace") return;
      const a = adapterRef.current;
      if (e.key === "AudioVolumeUp") nudgeVolumeRef.current(0.1);
      else if (e.key === "AudioVolumeDown") nudgeVolumeRef.current(-0.1);
      else if (e.key === "MediaRewind") void a?.seekBy(-SEEK_STEP);
      else if (e.key === "MediaFastForward") void a?.seekBy(SEEK_STEP);
      else if (e.key === "m") setMenu((m) => (m ? null : "audio"));
      else if (e.key === "p" || e.key === "MediaPlayPause") void togglePlay();
      else if (!osd) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
      bump();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousemove", bump);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousemove", bump);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osd, mini]);

  // Read from the latest state, not the render the key handler was made in: the phone remote's "play" is a key
  // press, and a handler that remembered an old status paused a playing picture "to play" it and the other way round.
  // The phone remote's "+" / "−": a step of the volume, with the level shown for a moment (the same capsule as over the button).
  nudgeVolumeRef.current = (d) => {
    const a = adapterRef.current;
    if (!a) return;
    const v = Math.min(1, Math.max(0, (stateRef.current.muted ? 0 : stateRef.current.volume) + d));
    void a.setVolume(v);
    if (v > 0 && stateRef.current.muted) void a.setMuted(false);
    setVolumeByMouse(true);
    setVolumeOpen(true);
    window.clearTimeout(volumeLeave.current);
    volumeLeave.current = window.setTimeout(() => setVolumeOpen(false), 1600);
  };
  // The level for the phone remote's bar.
  useEffect(() => {
    document.documentElement.style.setProperty("--player-volume", String(state.muted ? 0 : state.volume));
    return () => {
      document.documentElement.style.removeProperty("--player-volume");
    };
  }, [state.volume, state.muted]);

  const togglePlay = async () => {
    const a = adapterRef.current;
    if (!a) return;
    const st = stateRef.current.status;
    if (st === "playing" || st === "buffering") await a.pause();
    else await a.play();
  };

  const openMenu = (kind: TrackKind) => {
    setVolumeOpen(false);
    setEpisodesOpen(false);
    setQualityOpen(false);
    setMenu((m) => (m === kind ? null : kind));
  };

  const toggleVolume = () => {
    setMenu(null);
    setEpisodesOpen(false);
    setQualityOpen(false);
    setVolumeByMouse(false);
    setVolumeOpen((v) => !v);
  };

  const toggleEpisodes = () => {
    setMenu(null);
    setVolumeOpen(false);
    setQualityOpen(false);
    setEpisodesOpen((v) => !v);
  };

  const toggleQuality = () => {
    setMenu(null);
    setVolumeOpen(false);
    setEpisodesOpen(false);
    setQualityOpen((v) => !v);
  };

  const pickQuality = (index: number) => {
    setQualityOpen(false);
    if (index === qIdx) return;
    setResumeAt(state.position);
    setQIdx(index);
  };

  const tracks = state.tracks.filter((t) => t.kind === menu);
  const progress = Number.isFinite(state.duration) && state.duration > 0 ? state.position / state.duration : 0;
  const isPlaying = state.status === "playing";

  if (mini) {
    return <MiniPlayerChrome title={title} playing={isPlaying} onToggle={() => void togglePlay()} onExpand={expandPlayer} onClose={closePlayer} />;
  }

  return (
    <FocusGroup focusKey="screen:player" className={`player player--tvos ${isTauri ? "player--mpv" : ""} ${revealed ? "player--revealed" : ""} ${osd ? "" : "player--idle"}`} isFocusBoundary>
      {isTauri ? <div className="player__video-hole" /> : <video ref={videoRef} playsInline autoPlay />}

      <LiveSubtitles cues={filmSubs.cues} position={state.position} active={filmTr} note={trHint} raised={osd} />

      {showStreamStats && <StreamStats stats={state.stats} bufferedAhead={state.bufferedAhead} swarm={swarm} />}

      <PlayFlash status={state.status} />

      {(state.status === "loading" || state.status === "buffering") && (
        <div className="player__center">
          <div className="player__center-card">
            <Spinner />
            <p className="player__center-label">{state.status === "loading" ? "Подключение…" : "Буферизация…"}</p>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div className="player__center">
          <div className="player__center-card player__center-card--error">
            <OfflineIcon className="player__center-icon" />
            <p className="player__center-label">Не удалось воспроизвести</p>
            <p className="player__center-hint">{state.error ?? "Попробуйте другую раздачу."}</p>
          </div>
        </div>
      )}

      <div className={`player__osd ${osd ? "" : "is-hidden"}`} style={{ "--osd-dim": playerDim * 2, "--osd-scale": prefs.uiScale } as React.CSSProperties}>
        <div className="player__top">
          <Focusable back as="button" className="icon-btn" focusKey="pl:back" onPress={() => back()} scroll={false}>
            <BackIcon />
          </Focusable>
        </div>

        <div className="player__bottom">
          <div className="player__now-row">
            <p className="player__now player__now--movie">
              <b>{title}</b>
            </p>
            <span className="player__time">
              {fmt(state.position)} / {fmt(state.duration)}
            </span>
          </div>
          <SeekBar
            focusKey="pl:seek"
            progress={progress}
            duration={state.duration}
            seekStep={SEEK_STEP}
            onActivity={bump}
            onSeekBy={(delta) => void adapterRef.current?.seekBy(delta)}
            onSeekTo={(pos) => void adapterRef.current?.seek(pos)}
          />
          <div className="player__controls">
            <div className="player__controls-side player__controls-side--left">
              {episodes && episodes.files.length > 1 && (
                <Focusable
                  as="button"
                  className={`icon-btn ${episodesOpen ? "icon-btn--active" : ""}`}
                  focusKey="pl:episodes"
                  onPress={toggleEpisodes}
                  scroll={false}
                >
                  <EpisodesIcon />
                </Focusable>
              )}
              <Focusable as="button" className="icon-btn" focusKey="pl:audio" onPress={() => openMenu("audio")} scroll={false}>
                <TracksIcon />
              </Focusable>
              <Focusable as="button" className="icon-btn" focusKey="pl:subs" onPress={() => openMenu("subtitle")} scroll={false}>
                <SubtitlesIcon />
              </Focusable>
              {isTauri && (
                <Focusable
                  as="button"
                  className={`icon-btn ${pictureOpen ? "icon-btn--active" : ""}`}
                  focusKey="pl:picture"
                  onPress={() => setPictureOpen((o) => !o)}
                  scroll={false}
                >
                  <PlayerSettingsIcon />
                </Focusable>
              )}
              {qualities && qualities.length > 1 && (
                <Focusable
                  as="button"
                  className={`icon-btn ${qualityOpen ? "icon-btn--active" : ""}`}
                  focusKey="pl:quality"
                  onPress={toggleQuality}
                  scroll={false}
                >
                  <GearIcon />
                </Focusable>
              )}
            </div>

            <div className="player__controls-center">
              <Focusable as="button" className="icon-btn" focusKey="pl:rew" onPress={() => void adapterRef.current?.seekBy(-SEEK_STEP)} scroll={false}>
                <RewindIcon />
              </Focusable>
              <Focusable as="button" className="icon-btn icon-btn--lg" focusKey="pl:play" autoFocus onPress={() => void togglePlay()} scroll={false}>
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </Focusable>
              <Focusable as="button" className="icon-btn" focusKey="pl:fwd" onPress={() => void adapterRef.current?.seekBy(SEEK_STEP)} scroll={false}>
                <ForwardIcon />
              </Focusable>
              {nextEpisode && (
                <Focusable as="button" className="icon-btn" focusKey="pl:next-episode" onPress={goToNextEpisode} scroll={false}>
                  <NextEpisodeIcon />
                </Focusable>
              )}
            </div>

            <div className="player__controls-side player__controls-side--right">
              {isTauri && (
                <Focusable as="button" className="icon-btn" focusKey="pl:mini" onPress={minimize} scroll={false}>
                  <MiniPlayerIcon />
                </Focusable>
              )}
              <div
                className="volume-control"
                onMouseEnter={() => {
                  window.clearTimeout(volumeLeave.current);
                  if (osd && !volumeOpen && !menu && !episodesOpen && !qualityOpen && !pictureOpen) {
                    setVolumeByMouse(true);
                    setVolumeOpen(true);
                  }
                }}
                onMouseLeave={(e) => {
                  // Held down on the level (dragging) — it stays until the press is over elsewhere.
                  if (!volumeByMouse || e.buttons & 1) return;
                  window.clearTimeout(volumeLeave.current);
                  volumeLeave.current = window.setTimeout(() => {
                    setVolumeOpen(false);
                    void setFocus("pl:vol");
                  }, 280);
                }}
              >
                <Focusable
                  as="button"
                  className={`icon-btn ${volumeOpen ? "icon-btn--active" : ""}`}
                  focusKey="pl:vol"
                  // The level is already up under the mouse: a click on the button silences or restores the sound.
                  onPress={() => (volumeOpen && volumeByMouse ? void adapterRef.current?.setMuted(!state.muted) : toggleVolume())}
                  scroll={false}
                >
                  {state.muted || state.volume === 0 ? <MuteIcon /> : <VolumeIcon />}
                </Focusable>
                {volumeOpen && osd && (
                  <FocusGroup focusKey="player:volume" className="volume-popup" preferredChildFocusKey="vol:slider" isFocusBoundary>
                    <VolumeSlider
                      focusKey="vol:slider"
                      autoFocus={!volumeByMouse}
                      volume={state.muted ? 0 : state.volume}
                      onChange={(v) => {
                        void adapterRef.current?.setVolume(v);
                        if (v > 0 && state.muted) void adapterRef.current?.setMuted(false);
                        bump();
                      }}
                      onClose={() => {
                        setVolumeOpen(false);
                        bump();
                        void setFocus("pl:vol");
                      }}
                    />
                    <Focusable
                      as="button"
                      className="volume-popup__mute"
                      focusKey="vol:mute"
                      onPress={() => void adapterRef.current?.setMuted(!state.muted)}
                      scroll={false}
                    >
                      {state.muted ? <MuteIcon /> : <VolumeIcon />}
                    </Focusable>
                  </FocusGroup>
                )}
              </div>
              <FullscreenButton focusKey="pl:fullscreen" />
            </div>
          </div>
        </div>
      </div>

      {menu && osd && (
        <Modal
          focusKey="player:menu"
          preferredChildFocusKey="menu:0"
          className="links-tv"
          onClose={() => {
            setMenu(null);
            bump();
          }}
        >
          <h3 className="links-tv__title">{menu === "audio" ? "Аудиодорожка" : "Субтитры"}</h3>
          <div className="links-tv__list links-tv__scroll">
            {menu === "subtitle" && (
              <TrackItem
                focusKey="menu:off"
                label="Выключены"
                active={!filmTr && !tracks.some((t) => t.selected)}
                onPress={() => {
                  turnTranslationOff();
                  void adapterRef.current?.selectTrack("subtitle", null);
                  if (filmId) rememberTrack(filmId, "subtitle", null);
                }}
                autoFocus
              />
            )}
            {menu === "subtitle" && canTranslate && (
              <TrackItem
                focusKey="menu:translate"
                label="Локальный перевод на русский"
                hint={translatorReady ? undefined : "скачайте в настройках"}
                active={filmTr}
                onPress={() => {
                  if (filmTr) {
                    turnTranslationOff();
                  } else if (!translatorReady) {
                    setTrHint("Для перевода скачайте движок и модели: Настройки → Локальный перевод.");
                  } else {
                    // Embedded subtitles never show on top of the translation.
                    void adapterRef.current?.selectTrack("subtitle", null);
                    setTrHint("Перевод запускается: первые строки появятся через полминуты.");
                    setFilmTr(true);
                  }
                  setMenu(null);
                  bump();
                }}
              />
            )}
            {tracks.length === 0 && menu === "audio" && <p className="links-tv__text">Только одна дорожка</p>}
            {tracks.map((t, i) => (
              <TrackItem
                key={t.id}
                focusKey={`menu:${i}`}
                label={trackLabel(t, tracks, i)}
                active={t.selected && !(menu === "subtitle" && filmTr)}
                onPress={() => {
                  // An embedded track replaces the translation — never both on screen.
                  if (menu === "subtitle") turnTranslationOff();
                  void adapterRef.current?.selectTrack(menu, t.id);
                  if (filmId) rememberTrack(filmId, menu, t);
                }}
                autoFocus={menu === "audio" && i === 0}
              />
            ))}
          </div>
          <CloseRow
            focusKey="menu:close"
            onPress={() => {
              setMenu(null);
              bump();
            }}
          />
        </Modal>
      )}

      {pictureOpen && osd && (
        <PicturePanel
          adapterRef={adapterRef}
          onClose={() => {
            setPictureOpen(false);
            bump();
          }}
        />
      )}

      {qualityOpen && osd && qualities && (
        <Modal
          focusKey="player:quality"
          preferredChildFocusKey={`q:${qIdx}`}
          className="links-tv"
          onClose={() => {
            setQualityOpen(false);
            bump();
          }}
        >
          <h3 className="links-tv__title">Качество</h3>
          <div className="links-tv__list links-tv__scroll">
            {[...qualities.keys()].reverse().map((i) => (
              <TrackItem
                key={qualities[i].height}
                focusKey={`q:${i}`}
                label={`${qualities[i].height}p`}
                active={i === qIdx}
                onPress={() => pickQuality(i)}
                autoFocus={i === qIdx}
              />
            ))}
          </div>
          <CloseRow
            focusKey="q:close"
            onPress={() => {
              setQualityOpen(false);
              bump();
            }}
          />
        </Modal>
      )}

      {skipTarget && autoNext === null && (
        <Focusable as="button" className="skip-btn" focusKey="player:skip" scroll={false} onPress={() => skipNow()}>
          <span className="skip-btn__text">{skipTarget.label}</span>
          <i className="skip-btn__bar" style={{ transform: `scaleX(${Math.max(0, Math.min(1, (skipTarget.end - state.position) / Math.max(1, skipTarget.end - skipTarget.from)))})` }} />
        </Focusable>
      )}
      {skipAnnounce && !skipTarget && autoNext === null && (
        <div className="skip-btn skip-btn--note" role="status">
          <span className="skip-btn__text">{skipAnnounce.phase === "inside" ? (skipAnnounce.toNext ? "Следующая серия…" : "Пропускаю…") : skipAnnounce.label}</span>
        </div>
      )}

      {autoNext !== null && nextEpisode && (
        <div className="autonext" role="status">
          <div className="autonext__card">
            <div className="autonext__title">Следующая серия через {autoNext} с</div>
            <div className="autonext__name">{episodeLabel(episodeKey(nextEpisode), nextEpisode.name)}</div>
            <div className="autonext__actions">
              <Focusable
                as="button"
                className="btn"
                focusKey="autonext:cancel"
                scroll={false}
                onPress={() => {
                  autoNextCancelled.current = true;
                  setAutoNext(null);
                }}
              >
                Отмена
              </Focusable>
              <Focusable
                as="button"
                className="btn btn--primary"
                focusKey="autonext:now"
                autoFocus
                scroll={false}
                onPress={() => {
                  setAutoNext(null);
                  goToNextEpisode();
                }}
              >
                Смотреть сейчас
              </Focusable>
            </div>
          </div>
        </div>
      )}

      {episodesOpen && osd && episodes && (
        <Modal
          focusKey="player:episodes"
          preferredChildFocusKey={`ep:${episodes.index}`}
          className="links-tv"
          onClose={() => {
            setEpisodesOpen(false);
            bump();
          }}
        >
          <h3 className="links-tv__title">Серии</h3>
          <div className="links-tv__list links-tv__scroll">
            {episodes.files.map((f, i) => (
              <TrackItem
                key={f.id}
                focusKey={`ep:${i}`}
                label={f.name}
                hint={episodeHint(episodes.hash, filmId, f)}
                active={i === episodes.index}
                onPress={() => void goToEpisode(i)}
                autoFocus={i === episodes.index}
                toClose="ep:close"
              />
            ))}
          </div>
          <CloseRow
            focusKey="ep:close"
            onPress={() => {
              setEpisodesOpen(false);
              bump();
            }}
          />
        </Modal>
      )}
    </FocusGroup>
  );
}

/** "✓ просмотрено" / "37%" for the episode list — progress is kept per episode, across releases. */
function episodeHint(_hash: string, filmId: number | undefined, f: TorrentFile): string | undefined {
  if (!filmId) return undefined;
  const e = useEpisodeProgress.getState().entry(filmId, episodeKey(f));
  if (!e) return undefined;
  if (e.watched) return "✓ просмотрено";
  const pct = Math.round((e.position / e.duration) * 100);
  return pct >= 2 ? `${pct}%` : undefined;
}

function StreamStats({ stats, bufferedAhead, swarm }: { stats: PlayerStats; bufferedAhead: number; swarm: SwarmStats | null }) {
  const codec = [stats.videoCodec, stats.audioCodec].filter(Boolean).join(" / ");
  const rows: [string, string][] = [
    ["Разрешение", stats.width && stats.height ? `${stats.width}×${stats.height}` : "—"],
    ["FPS", stats.fps != null ? String(stats.fps) : "—"],
    ["Битрейт", stats.bitrateKbps ? `${(stats.bitrateKbps / 1000).toFixed(1)} Мбит/с` : "—"],
    ["Кодек", codec || "—"],
    ["Буфер", `${bufferedAhead.toFixed(1)} с`],
    ["Потеряно кадров", stats.droppedFrames != null ? String(stats.droppedFrames) : "—"],
  ];
  if (swarm) {
    rows.push(
      ["Загрузка", `${((swarm.downloadSpeed * 8) / 1e6).toFixed(1)} Мбит/с`],
      ["Пиры", `${swarm.activePeers} из ${swarm.totalPeers}`],
      ["Сиды", String(swarm.seeders)],
    );
  }
  return (
    <div className="player__stats">
      <p className="player__stats-title">Статистика потока</p>
      {rows.map(([label, value]) => (
        <div className="player__stats-row" key={label}>
          <span>{label}</span>
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

function CheckMark() {
  return (
    <svg className="links-tv__check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CloseRow({ focusKey, onPress }: { focusKey: string; onPress: () => void }) {
  return (
    <Focusable as="button" back focusKey={focusKey} className="links-tv__row links-tv__row--close links-tv__foot" scroll={false} onPress={onPress}>
      <span className="links-tv__name">Закрыть</span>
    </Focusable>
  );
}

function TrackItem({
  focusKey,
  label,
  hint,
  active,
  onPress,
  autoFocus,
  toClose,
}: {
  focusKey: string;
  label: string;
  hint?: string;
  active: boolean;
  onPress: () => void;
  autoFocus?: boolean;
  /** A long list: → jumps to the close row instead of going down through every row. */
  toClose?: string;
}) {
  return (
    <Focusable
      as="button"
      className={`links-tv__row ${active ? "is-active" : ""}`}
      focusKey={focusKey}
      onPress={onPress}
      autoFocus={autoFocus}
      scroll={false}
      onArrowPress={(direction) => {
        if (!toClose || direction !== "right") return true;
        void setFocus(toClose);
        return false;
      }}
    >
      <span className="links-tv__name">{label}</span>
      {hint && hint.trim().toLowerCase() !== label.trim().toLowerCase() && <span className="links-tv__hint">{hint}</span>}
      {active && <CheckMark />}
    </Focusable>
  );
}
