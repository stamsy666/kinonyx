import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { buildCatchupUrl, isWithinCatchupWindow, nowNext, type Programme } from "@kinonyx/epg";
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
  ArchiveIcon,
  BackIcon,
  FavoriteIcon,
  Focusable,
  FocusGroup,
  ForwardIcon,
  MuteIcon,
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
import { useApp } from "../../store/app";
import { useTv } from "../../store/tv";
import { useChannelFavorites } from "../../store/channelFavorites";
import { isTauri } from "../../data/io";
import { SeekBar } from "../../components/SeekBar";
import { useMpvReveal } from "../../components/useMpvReveal";
import { FocusHighlight } from "../../components/FocusHighlight";
import { VolumeSlider } from "../../components/VolumeSlider";
import { Modal } from "../../components/Modal";
import { FullscreenButton } from "../../components/FullscreenButton";
import { LiveSubtitles, useLiveTranslation } from "../../components/LiveSubtitles";
import { useVoiceOver, voiceAudio } from "../../components/VoiceOver";
import { useTranslator } from "../../store/translator";

/** PortoTV's live-TV player: live guide, DVR seek, catch-up archive — ported as-is. */

const OSD_TIMEOUT = 4000;
const SEEK_STEP = 30;
const DEFAULT_CATCHUP_DAYS = 3;
const ARCHIVE_PAGE_SIZE = 20;

function fmt(sec: number) {
  if (!Number.isFinite(sec)) return "--:--";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

function timeOf(t: number) {
  return new Date(t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function timeRange(p: { start: number; stop: number }) {
  return `${timeOf(p.start)}–${timeOf(p.stop)}`;
}

function dayLabel(ts: number, now: number) {
  const d = new Date(ts);
  const n = new Date(now);
  const diffDays = Math.floor(
    (new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function TvPlayerScreen({ channelId }: { channelId: string }) {
  const playlist = useTv((s) => s.playlist);
  const activePlaylistId = useTv((s) => s.activePlaylistId);
  const programmesFor = useTv((s) => s.programmesFor);
  const lastArchiveFocus = useTv((s) => s.lastArchiveFocus);
  const setLastArchiveFocus = useTv((s) => s.setLastArchiveFocus);
  const epgStatus = useTv((s) => s.epgStatus);
  const back = useApp((s) => s.back);
  const showStreamStats = useApp((s) => s.showStreamStats);
  const channel = useMemo(() => playlist?.channels.find((c) => c.id === channelId), [playlist, channelId]);
  const isFavChannel = useChannelFavorites(
    (s) => !!activePlaylistId && s.items.some((f) => f.playlistId === activePlaylistId && f.channel.id === channelId),
  );
  const toggleChannelFavorite = useChannelFavorites((s) => s.toggle);

  const videoRef = useRef<HTMLVideoElement>(null);
  const adapterRef = useRef<PlayerAdapter | null>(null);
  const [state, setState] = useState<PlayerState>(INITIAL_STATE);
  const [osd, setOsd] = useState(true);
  const [menu, setMenu] = useState<TrackKind | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [archive, setArchive] = useState<{ programme: Programme } | null>(null);
  const hideTimer = useRef<number>(0);

  // The guide often finishes loading after the player opens, and "now playing" must
  // advance over a long session — recompute periodically, not just once at mount.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const guide = useMemo(() => (channel ? nowNext(programmesFor(channel), clock) : {}), [channel, programmesFor, clock, epgStatus]);
  const canArchive = Boolean(channel?.catchup);

  const archiveDays = useMemo(() => {
    if (!channel?.catchup) return [];
    const now = Date.now();
    const list = (programmesFor(channel) ?? []).filter((p) => p.start < now && isWithinCatchupWindow(channel.catchup, p.start, now));
    const byDay = new Map<string, Programme[]>();
    for (const p of [...list].sort((a, b) => b.start - a.start)) {
      const d = new Date(p.start);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const bucket = byDay.get(key);
      if (bucket) bucket.push(p);
      else byDay.set(key, [p]);
    }
    return [...byDay.entries()].map(([key, items]) => ({ key, label: dayLabel(items[0].start, now), items }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, programmesFor, clock, epgStatus]);

  const archiveTotal = useMemo(() => archiveDays.reduce((n, d) => n + d.items.length, 0), [archiveDays]);

  // A week of a dense schedule is 100+ entries — rendering and registering them all at
  // once lagged. Reveal ARCHIVE_PAGE_SIZE at a time as the viewer scrolls/navigates down.
  const [archiveVisible, setArchiveVisible] = useState(ARCHIVE_PAGE_SIZE);
  useEffect(() => {
    if (!archiveOpen) return;
    const rememberedStart = channel ? lastArchiveFocus[channel.id] : undefined;
    if (rememberedStart != null) {
      let flatIndex = -1;
      let count = 0;
      outer: for (const day of archiveDays) {
        for (const p of day.items) {
          if (p.start === rememberedStart) {
            flatIndex = count;
            break outer;
          }
          count++;
        }
      }
      if (flatIndex >= 0) {
        setArchiveVisible(Math.min(archiveTotal, Math.ceil((flatIndex + 1) / ARCHIVE_PAGE_SIZE) * ARCHIVE_PAGE_SIZE));
        return;
      }
    }
    setArchiveVisible(ARCHIVE_PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveOpen]);
  const loadMoreArchive = useCallback(() => {
    setArchiveVisible((v) => Math.min(archiveTotal, v + ARCHIVE_PAGE_SIZE));
  }, [archiveTotal]);

  const visibleArchiveDays = useMemo(() => {
    let remaining = archiveVisible;
    const out: typeof archiveDays = [];
    for (const day of archiveDays) {
      if (remaining <= 0) break;
      const items = day.items.slice(0, remaining);
      out.push({ ...day, items });
      remaining -= items.length;
    }
    return out;
  }, [archiveDays, archiveVisible]);

  const rememberedArchiveVisible =
    channel != null &&
    lastArchiveFocus[channel.id] != null &&
    visibleArchiveDays.some((day) => day.items.some((p) => p.start === lastArchiveFocus[channel.id]));

  const baseSource: PlaySource | null = useMemo(() => {
    if (!channel) return null;
    if (archive) {
      const durationSec = Math.max(60, (archive.programme.stop - archive.programme.start) / 1000);
      const url = buildCatchupUrl(channel.url, channel.catchup, { start: new Date(archive.programme.start), durationSec });
      return { url, title: `${channel.name} · ${archive.programme.title}`, live: false };
    }
    return { url: channel.url, title: channel.name, live: true };
  }, [channel, archive]);

  const translateOn = useTranslator((s) => s.active);
  const setTranslateOn = useTranslator((s) => s.setActive);
  const translatorReady = useTranslator((s) => s.ready());
  const voiceOn = useTranslator((s) => s.voiceActive);
  const setVoiceOn = useTranslator((s) => s.setVoiceActive);
  const voiceReady = useTranslator((s) => s.voiceReady());
  const translationEnabled = useTranslator((s) => s.translationEnabled());
  const voiceEnabled = useTranslator((s) => s.voiceEnabled);
  // The session runs while either the subtitles or the voice-over need it.
  const sessionOn = translateOn || voiceOn;
  const refreshTranslator = useTranslator((s) => s.refresh);
  useEffect(() => {
    void refreshTranslator();
  }, [refreshTranslator]);
  const live = useLiveTranslation(baseSource, sessionOn && isTauri, voiceOn, state.position, state.status === "playing");
  const source = live.source;
  const [translatorHint, setTranslatorHint] = useState<string | null>(null);

  // Embedded subtitles are off on every channel until the viewer picks a track, and never
  // shown on top of the local translation. mpv auto-selects "default"-flagged tracks on
  // each load (including the translator's relay stream), so the choice is reconciled
  // against the live track list rather than set once.
  const [wantedSub, setWantedSub] = useState<string | null>(null);
  useEffect(() => setWantedSub(null), [baseSource]);
  useEffect(() => {
    const subs = state.tracks.filter((t) => t.kind === "subtitle");
    const want = !translateOn && wantedSub != null && subs.some((t) => t.id === wantedSub) ? wantedSub : null;
    const selected = subs.find((t) => t.selected)?.id ?? null;
    if (selected !== want) void adapterRef.current?.selectTrack("subtitle", want);
  }, [state.tracks, translateOn, wantedSub]);

  const bump = useCallback(() => {
    setOsd(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setOsd(false);
      setMenu(null);
      setArchiveOpen(false);
      setVolumeOpen(false);
    }, OSD_TIMEOUT);
  }, []);

  // mpv renders into a native window behind a transparent hole — see useMpvReveal.
  const revealed = useMpvReveal(state.status, source);

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
    // No source while a translation session spins up: release the direct stream so the
    // provider only ever sees one connection (the translator's recorder).
    if (!source) {
      if (sessionOn) void adapterRef.current.stop();
      return;
    }
    void adapterRef.current.load(source);
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => {
    return onBack(() => {
      if (volumeOpen) {
        setVolumeOpen(false);
        bump();
        return true;
      }
      if (archiveOpen) {
        setArchiveOpen(false);
        bump();
        return true;
      }
      if (menu) {
        setMenu(null);
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
  }, [volumeOpen, archiveOpen, menu, osd, back, bump]);

  useEffect(() => {
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
  }, [osd, bump]);

  const togglePlay = async () => {
    const a = adapterRef.current;
    if (!a) return;
    if (state.status === "playing") await a.pause();
    else await a.play();
  };

  const openMenu = (kind: TrackKind) => {
    setArchiveOpen(false);
    setVolumeOpen(false);
    setMenu((m) => (m === kind ? null : kind));
  };

  const toggleArchive = () => {
    setMenu(null);
    setVolumeOpen(false);
    setArchiveOpen((v) => !v);
  };

  const toggleVolume = () => {
    setMenu(null);
    setArchiveOpen(false);
    setVolumeOpen((v) => !v);
  };

  const selectArchive = (programme: Programme) => {
    setArchive({ programme });
    setArchiveOpen(false);
    if (channel) setLastArchiveFocus(channel.id, programme.start);
    bump();
    void setFocus("pl:play");
  };

  const resumeLive = () => {
    setArchive(null);
    bump();
  };

  // A failed translator (no GPU, missing model, crashed engine) falls back to the normal
  // stream instead of leaving the viewer on a stopped player.
  useEffect(() => {
    if (live.state !== "error") return;
    setTranslatorHint(`Локальный перевод выключен: ${live.error ?? "ошибка"}`);
    setTranslateOn(false);
    setVoiceOn(false);
  }, [live.state, live.error, setTranslateOn, setVoiceOn]);
  useEffect(() => {
    if (live.voiceState !== "error") return;
    setTranslatorHint(`Закадровый голос выключен: ${live.voiceError ?? "ошибка"}`);
    setVoiceOn(false);
  }, [live.voiceState, live.voiceError, setVoiceOn]);
  useEffect(() => {
    if (voiceOn && live.voiceState === "starting") setTranslatorHint("Загружаю озвучку — первые фразы прозвучат через полминуты…");
    else if (live.voiceState === "ready") setTranslatorHint((h) => (h?.startsWith("Загружаю озвучку") ? null : h));
  }, [voiceOn, live.voiceState]);

  useVoiceOver({
    enabled: voiceOn && isTauri,
    clips: live.clips,
    position: state.position,
    playing: state.status === "playing",
    volume: state.volume,
    muted: state.muted,
    setDuck: (g) => void adapterRef.current?.setDuck?.(g),
  });
  useEffect(() => {
    if (!translatorHint) return;
    const t = window.setTimeout(() => setTranslatorHint(null), 9000);
    return () => window.clearTimeout(t);
  }, [translatorHint]);

  const toggleTranslation = () => {
    if (!translateOn && !translatorReady) {
      setTranslatorHint("Для перевода скачайте движок и модели: Настройки → Локальный перевод.");
      return;
    }
    setTranslateOn(!translateOn);
    setMenu(null);
    bump();
  };

  const toggleVoice = () => {
    if (!voiceOn && !voiceReady) {
      setTranslatorHint("Для закадрового голоса скачайте озвучку: Настройки → Закадровый голос.");
      return;
    }
    // Inside the key/click handler: lets the voice-over's audio start without a gesture later.
    if (!voiceOn) voiceAudio();
    setVoiceOn(!voiceOn);
    setMenu(null);
    bump();
  };

  // A channel id that isn't in the (freshly loaded) playlist — a stale favourite whose
  // playlist has since changed, most likely. Used to render nothing at all here: a
  // silent black screen with no back button and no way to tell what went wrong.
  if (!channel) {
    return (
      <FocusGroup focusKey="screen:player" className="player" isFocusBoundary>
        <div className="player__osd">
          <div className="player__top">
            <Focusable as="button" className="icon-btn" focusKey="pl:back" onPress={() => back()} autoFocus scroll={false}>
              <BackIcon />
            </Focusable>
          </div>
        </div>
        <div className="player__center">
          <OfflineIcon className="player__center-icon" />
          <p className="player__center-label">Канал не найден</p>
          <p className="player__center-hint">Плейлист мог измениться — попробуйте выбрать канал заново из списка.</p>
        </div>
      </FocusGroup>
    );
  }

  const tracks = state.tracks.filter((t) => t.kind === menu);
  const bufferProgress = Number.isFinite(state.duration) && state.duration > 0 ? state.position / state.duration : 0;
  // Near the live edge the guide-based progress reads smoother than the DVR buffer ratio;
  // once the viewer rewinds away from the edge, follow the buffer so the bar tracks the seek.
  const atLiveEdge = state.live && Number.isFinite(state.duration) && state.duration - state.position < 15;
  const progress =
    !archive && state.live && (atLiveEdge || sessionOn) && guide.progress !== undefined ? guide.progress : bufferProgress;
  const isPlaying = state.status === "playing";
  const nowInfo = archive ? archive.programme : guide.now;

  return (
    <FocusGroup focusKey="screen:player" className={`player ${isTauri ? "player--mpv" : ""} ${revealed ? "player--revealed" : ""}`} isFocusBoundary>
      {isTauri ? <div className="player__video-hole" /> : <video ref={videoRef} playsInline autoPlay />}

      {showStreamStats && <StreamStats stats={state.stats} live={state.live} bufferedAhead={state.bufferedAhead} />}

      {(state.status === "loading" || state.status === "buffering" || (sessionOn && !source)) && (
        <div className="player__center">
          <Spinner />
          <p className="player__center-label">
            {sessionOn && !live.started ? "Готовлю перевод…" : state.status === "loading" ? "Подключение…" : "Буферизация…"}
          </p>
          {sessionOn && !live.started && (
            <p className="player__center-hint">Эфир начнётся с отставанием {live.delay} с — за это время переводчик успевает опередить речь.</p>
          )}
        </div>
      )}

      <LiveSubtitles cues={live.cues} position={state.position} active={translateOn} note={translatorHint} raised={osd} />

      {state.status === "error" && (
        <div className="player__center">
          <OfflineIcon className="player__center-icon" />
          <p className="player__center-label">Канал недоступен</p>
          <p className="player__center-hint">{state.error ?? "Проверьте подключение или попробуйте другой канал."}</p>
        </div>
      )}

      <div className={`player__osd ${osd ? "" : "is-hidden"}`}>
        <div className="player__top player__top--tv">
          <Focusable as="button" className="icon-btn" focusKey="pl:back" onPress={() => back()} scroll={false}>
            <BackIcon />
          </Focusable>
          <div className="player__info">
            <PlayerLogo src={channel.logo} name={channel.name} />
            <h2 className="player__channel">{channel.name}</h2>
          </div>
          <div className="player__status">
            {archive ? (
              <Focusable as="button" className="btn btn--ghost archive-badge" focusKey="pl:live" onPress={resumeLive} scroll={false}>
                В эфир
              </Focusable>
            ) : state.live ? (
              <span className="live-badge">LIVE</span>
            ) : (
              <span>
                {fmt(state.position)} / {fmt(state.duration)}
              </span>
            )}
          </div>
        </div>

        <div className="player__bottom">
          <p className="player__now player__now--center">
            {nowInfo ? (
              <>
                <b>{nowInfo.title}</b> · {timeRange(nowInfo)}
                {!archive && guide.next && <span style={{ color: "var(--text-faint)" }}> · далее: {guide.next.title}</span>}
              </>
            ) : (
              <span style={{ color: "var(--text-faint)" }}>Нет данных программы</span>
            )}
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
              {channel && activePlaylistId && (
                <Focusable
                  as="button"
                  className={`icon-btn ${isFavChannel ? "icon-btn--active" : ""}`}
                  focusKey="pl:favorite"
                  onPress={() => toggleChannelFavorite(activePlaylistId, channel)}
                  scroll={false}
                >
                  <FavoriteIcon fill={isFavChannel ? "currentColor" : "none"} />
                </Focusable>
              )}
              <Focusable as="button" className="icon-btn" focusKey="pl:audio" onPress={() => openMenu("audio")} scroll={false}>
                <TracksIcon />
              </Focusable>
              <Focusable as="button" className="icon-btn" focusKey="pl:subs" onPress={() => openMenu("subtitle")} scroll={false}>
                <SubtitlesIcon />
              </Focusable>
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
            </div>

            <div className="player__controls-side player__controls-side--right">
              {canArchive && (
                <Focusable
                  as="button"
                  className={`icon-btn ${archiveOpen ? "icon-btn--active" : ""}`}
                  focusKey="pl:archive"
                  onPress={toggleArchive}
                  scroll={false}
                >
                  <ArchiveIcon />
                </Focusable>
              )}
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
                        void setFocus(canArchive ? "pl:archive" : "pl:vol");
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
                active={!translateOn && !tracks.some((t) => t.selected)}
                onPress={() => {
                  setWantedSub(null);
                  if (translateOn) toggleTranslation();
                }}
                autoFocus
              />
            )}
            {/* Switched off in Settings (not just not downloaded) — not offered at all. */}
            {menu === "subtitle" && isTauri && translationEnabled && (
              <TrackItem
                focusKey="menu:translate"
                label="Локальный перевод на русский"
                hint={translatorReady ? `эфир −${live.delay} с` : "скачайте в настройках"}
                active={translateOn}
                onPress={toggleTranslation}
              />
            )}
            {menu === "subtitle" && isTauri && translationEnabled && voiceEnabled && (
              <TrackItem
                focusKey="menu:voice"
                label="Закадровый голос"
                hint={
                  !voiceReady
                    ? "скачайте в настройках"
                    : voiceOn && live.voiceState === "starting"
                      ? "загружается…"
                      : "голосом говорящего"
                }
                active={voiceOn}
                onPress={toggleVoice}
              />
            )}
            {tracks.length === 0 && menu === "audio" && <div className="empty">Только одна дорожка</div>}
            {tracks.map((t, i) => (
              <TrackItem
                key={t.id}
                focusKey={`menu:${i}`}
                label={t.title || t.lang || `Дорожка ${i + 1}`}
                hint={t.lang}
                active={t.selected && !(menu === "subtitle" && translateOn)}
                onPress={() => {
                  if (menu === "audio") {
                    void adapterRef.current?.selectTrack("audio", t.id);
                    return;
                  }
                  // An embedded track replaces the translation — never both on screen.
                  setWantedSub(t.id);
                  if (translateOn) {
                    setTranslateOn(false);
                    setMenu(null);
                    bump();
                  }
                }}
                autoFocus={menu === "audio" && i === 0}
              />
            ))}
          </div>
        </Modal>
      )}

      {archiveOpen && osd && (
        <Modal
          focusKey="player:archive"
          preferredChildFocusKey="arch:0"
          onClose={() => {
            setArchiveOpen(false);
            bump();
          }}
        >
          <div className="modal-panel__header">
            <h3>Архив эфира</h3>
            <span className="archive-panel__range">{channel.catchup?.days ?? DEFAULT_CATCHUP_DAYS} дн.</span>
          </div>
          <div
            className="modal-panel__list"
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) loadMoreArchive();
            }}
          >
            <FocusHighlight pad={0} radius="var(--radius-sm)" />
            {archiveDays.length === 0 && <div className="empty">Нет данных программы за доступный период архива</div>}
            {visibleArchiveDays.map((day, di) => (
              <div key={day.key}>
                <div className="archive-panel__day">{day.label}</div>
                {day.items.map((p, i) => {
                  const isLastRendered = di === visibleArchiveDays.length - 1 && i === day.items.length - 1;
                  return (
                    <ArchiveItem
                      key={`${day.key}:${i}`}
                      focusKey={`arch:${day.key}:${i}`}
                      programme={p}
                      active={archive?.programme.start === p.start}
                      onPress={() => selectArchive(p)}
                      onFocus={isLastRendered && archiveVisible < archiveTotal ? loadMoreArchive : undefined}
                      autoFocus={rememberedArchiveVisible ? p.start === lastArchiveFocus[channel.id] : di === 0 && i === 0}
                    />
                  );
                })}
              </div>
            ))}
            {archiveVisible < archiveTotal && <div className="archive-panel__more">Загрузка ещё…</div>}
          </div>
        </Modal>
      )}
    </FocusGroup>
  );
}

function initialsOf(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function PlayerLogo({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const showLogo = src && !failed;
  return (
    <div className="player__logo">
      {showLogo ? (
        <img src={src} alt="" loading="eager" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span className="player__logo-initials">{initialsOf(name)}</span>
      )}
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
      {hint && <span className="list-option__hint">{hint}</span>}
    </Focusable>
  );
}

function ArchiveItem({
  focusKey,
  programme,
  active,
  onPress,
  onFocus,
  autoFocus,
}: {
  focusKey: string;
  programme: Programme;
  active: boolean;
  onPress: () => void;
  onFocus?: () => void;
  autoFocus?: boolean;
}) {
  return (
    <Focusable
      as="button"
      className={`list-option list-option--stack ${active ? "is-active" : ""}`}
      focusKey={focusKey}
      onPress={onPress}
      onFocus={onFocus}
      autoFocus={autoFocus}
      scroll={true}
    >
      <span className="archive-item__time">{timeRange(programme)}</span>
      <span className="archive-item__title">{programme.title}</span>
    </Focusable>
  );
}

function StreamStats({ stats, live, bufferedAhead }: { stats: PlayerStats; live: boolean; bufferedAhead: number }) {
  const codec = [stats.videoCodec, stats.audioCodec].filter(Boolean).join(" / ");
  const rows: [string, string][] = [
    ["Разрешение", stats.width && stats.height ? `${stats.width}×${stats.height}` : "—"],
    ["FPS", stats.fps != null ? String(stats.fps) : "—"],
    ["Битрейт", stats.bitrateKbps ? `${(stats.bitrateKbps / 1000).toFixed(1)} Мбит/с` : "—"],
    ["Кодек", codec || "—"],
    ["Буфер", `${bufferedAhead.toFixed(1)} с`],
    ["Потеряно кадров", stats.droppedFrames != null ? String(stats.droppedFrames) : "—"],
    ["Режим", live ? "LIVE" : "Архив"],
  ];
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
