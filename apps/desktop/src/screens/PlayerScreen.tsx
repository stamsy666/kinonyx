import { useEffect, useMemo, useRef, useState } from "react";
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
} from "@kinonyx/player-core";
import {
  BackIcon,
  EpisodesIcon,
  Focusable,
  FocusGroup,
  ForwardIcon,
  GearIcon,
  MiniPlayerIcon,
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
import { useMpvReveal } from "../components/useMpvReveal";
import { FocusHighlight } from "../components/FocusHighlight";
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
}

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
  mini = false,
}: {
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
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
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
    return { url: curUrl, title, live: false, mpvOptions };
  }, [curUrl, curAudio, title, resumeAt, prefs]);

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
  // A press on the picture (anywhere outside the volume control) closes the volume slider.
  useCloseOnOutsidePress(volumeOpen, () => setVolumeOpen(false));

  // Episode of a series pack being played — progress is kept per episode (see store/episodeProgress.ts).
  const epKey = episodes ? episodeKey(episodes.files[episodes.index]) : null;

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
    replace({
      name: "player",
      title: file.name,
      url: nextUrl,
      hash: episodes.hash,
      filmId,
      film,
      poster,
      episodes: { hash: episodes.hash, files: episodes.files, index },
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
  }, [volumeOpen, menu, episodesOpen, qualityOpen, osd, back, mini]);

  useEffect(() => {
    if (mini) return; // …and does not swallow the keys of the screen the viewer is on
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Backspace") return;
      const a = adapterRef.current;
      if (e.key === "MediaRewind") void a?.seekBy(-SEEK_STEP);
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

  const togglePlay = async () => {
    const a = adapterRef.current;
    if (!a) return;
    if (state.status === "playing") await a.pause();
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
    <FocusGroup focusKey="screen:player" className={`player ${isTauri ? "player--mpv" : ""} ${revealed ? "player--revealed" : ""} ${osd ? "" : "player--idle"}`} isFocusBoundary>
      {isTauri ? <div className="player__video-hole" /> : <video ref={videoRef} playsInline autoPlay />}

      {showStreamStats && <StreamStats stats={state.stats} bufferedAhead={state.bufferedAhead} swarm={swarm} />}

      {(state.status === "loading" || state.status === "buffering") && (
        <div className="player__center">
          <Spinner />
          <p className="player__center-label">{state.status === "loading" ? "Подключение…" : "Буферизация…"}</p>
        </div>
      )}

      {state.status === "error" && (
        <div className="player__center">
          <OfflineIcon />
          <p className="player__center-label">Не удалось воспроизвести</p>
          <p className="player__center-hint">{state.error ?? "Попробуйте другую раздачу."}</p>
        </div>
      )}

      <div className={`player__osd ${osd ? "" : "is-hidden"}`} style={{ "--osd-dim": playerDim * 2, "--osd-scale": prefs.uiScale } as React.CSSProperties}>
        <div className="player__top">
          <Focusable back as="button" className="icon-btn" focusKey="pl:back" onPress={() => back()} scroll={false}>
            <BackIcon />
          </Focusable>
          <h2 className="player__title">{title}</h2>
          {isTauri ? (
            <Focusable as="button" className="icon-btn" focusKey="pl:mini" onPress={minimize} scroll={false}>
              <MiniPlayerIcon />
            </Focusable>
          ) : (
            <span style={{ width: 52 }} />
          )}
        </div>

        <div className="player__bottom">
          <p className="player__now" style={{ textAlign: "right" }}>
            {fmt(state.position)} / {fmt(state.duration)}
          </p>
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
              <div className="volume-control">
                <Focusable
                  as="button"
                  className={`icon-btn ${volumeOpen ? "icon-btn--active" : ""}`}
                  focusKey="pl:vol"
                  onPress={toggleVolume}
                  scroll={false}
                >
                  {state.muted || state.volume === 0 ? <MuteIcon /> : <VolumeIcon />}
                </Focusable>
                {volumeOpen && osd && (
                  <FocusGroup focusKey="player:volume" className="volume-popup" preferredChildFocusKey="vol:slider" isFocusBoundary>
                    <VolumeSlider
                      focusKey="vol:slider"
                      autoFocus
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
          onClose={() => {
            setMenu(null);
            bump();
          }}
        >
            <div className="modal-panel__header">
              <h3>{menu === "audio" ? "Аудиодорожка" : "Субтитры"}</h3>
            </div>
            <div className="modal-panel__list">
              <FocusHighlight pad={0} radius="var(--radius-sm)" />
              {menu === "subtitle" && (
                <TrackItem
                  focusKey="menu:off"
                  label="Выключены"
                  active={!tracks.some((t) => t.selected)}
                  onPress={() => void adapterRef.current?.selectTrack("subtitle", null)}
                  autoFocus
                />
              )}
              {tracks.length === 0 && menu === "audio" && <div className="empty">Только одна дорожка</div>}
              {tracks.map((t, i) => (
                <TrackItem
                  key={t.id}
                  focusKey={`menu:${i}`}
                  label={trackLabel(t, tracks, i)}
                  active={t.selected}
                  onPress={() => void adapterRef.current?.selectTrack(menu, t.id)}
                  autoFocus={menu === "audio" && i === 0}
                />
              ))}
            </div>
        </Modal>
      )}

      {qualityOpen && osd && qualities && (
        <Modal
          focusKey="player:quality"
          preferredChildFocusKey={`q:${qIdx}`}
          onClose={() => {
            setQualityOpen(false);
            bump();
          }}
        >
          <div className="modal-panel__header">
            <h3>Качество</h3>
          </div>
          <div className="modal-panel__list">
            <FocusHighlight pad={0} radius="var(--radius-sm)" />
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
        </Modal>
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
          onClose={() => {
            setEpisodesOpen(false);
            bump();
          }}
        >
          <div className="modal-panel__header">
            <h3>Серии</h3>
          </div>
          <div className="modal-panel__list">
            <FocusHighlight pad={0} radius="var(--radius-sm)" />
            {episodes.files.map((f, i) => (
              <TrackItem
                key={f.id}
                focusKey={`ep:${i}`}
                label={f.name}
                hint={episodeHint(episodes.hash, filmId, f)}
                active={i === episodes.index}
                onPress={() => void goToEpisode(i)}
                autoFocus={i === episodes.index}
              />
            ))}
          </div>
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

function TrackItem({
  focusKey,
  label,
  hint,
  active,
  onPress,
  autoFocus,
}: {
  focusKey: string;
  label: string;
  hint?: string;
  active: boolean;
  onPress: () => void;
  autoFocus?: boolean;
}) {
  return (
    <Focusable
      as="button"
      className={`list-option list-option--row ${active ? "is-active" : ""}`}
      focusKey={focusKey}
      onPress={onPress}
      autoFocus={autoFocus}
      scroll={false}
    >
      <span className="list-option__label">{label}</span>
      {hint && hint.trim().toLowerCase() !== label.trim().toLowerCase() && <span className="list-option__hint">{hint}</span>}
    </Focusable>
  );
}
