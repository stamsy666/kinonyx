import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logEvent } from "../../data/log";
import { PictureFooter, PictureInfo, PictureSettings, usePictureInfo } from "../../components/PicturePanel";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { buildCatchupUrl, isWithinCatchupWindow, nowNext, type Programme } from "@kinonyx/epg";
import {
  Html5Adapter,
  INITIAL_STATE,
  MpvAdapter,
  type PlayerAdapter,
  type PlayerState,
  type PlaySource,
} from "@kinonyx/player-core";
import { FocusGroup, Focusable, onBack } from "@kinonyx/ui";
import { useApp, type SubtitleBackground } from "../../store/app";
import { useTv } from "../../store/tv";
import { useChannelFavorites } from "../../store/channelFavorites";
import { isTauri } from "../../data/io";
import { KxSeekBar } from "../../components/player/KxSeekBar";
import { useMpvReveal } from "../../components/useMpvReveal";
import { MiniPlayerChrome, useCloseOnOutsidePress } from "../../components/MiniPlayer";
import { VolumeSlider } from "../../components/VolumeSlider";
import { KxButton, KxChannelLogo, KxError, KxLockup, KxPill, KxStreamStats, KxWait } from "../../components/player/PlayerChrome";
import { KxRow, KxSegmentRow, KxSheet, KxSheetLabel, KxSheetText, KxStackRow, KxTabs, type KxTab } from "../../components/player/PlayerSheet";
import {
  KxArchive,
  KxAudio,
  KxBack,
  KxForward,
  KxHeart,
  KxMini,
  KxMute,
  KxNext,
  KxPause,
  KxPicture,
  KxPlay,
  KxPrev,
  KxRewind,
  KxSubtitles,
  KxVolume,
} from "../../components/player/PlayerIcons";
import { FullscreenButton } from "../../components/FullscreenButton";
import { LiveSubtitles, useLiveTranslation } from "../../components/LiveSubtitles";
import { useVoiceOver, voiceAudio } from "../../components/VoiceOver";
import { useTranslator } from "../../store/translator";
import { translatorRelease } from "../../data/translator";
import { applySubtitleBackground, PLAYER_VOLUME_STEP, readFrameGeneration, useMpvLoadOptions } from "../../data/playerOptions";
import { preferredMpvAudioDevice } from "../../data/audioDevices";
import { trackLabel } from "../../data/trackLabel";
import { useWatchTracker } from "../../components/useWatchTracker";
import { usePresence } from "../../components/usePresence";
import { PlayFlash } from "../../components/PlayFlash";

/** PortoTV's live-TV player: live guide, DVR seek, catch-up archive — ported as-is. */

const SEEK_STEP = 30;
/** What the phone remote's and the media keys' "back/forward" move by (the remote's buttons say 15 seconds). */
const REMOTE_SEEK = 15;
const DEFAULT_CATCHUP_DAYS = 3;
const ARCHIVE_PAGE_SIZE = 20;

/** The windows of the channel player: the settings (three tabs) and the archive. */
type TvSheet = "audio" | "subtitle" | "picture" | "archive";

/** Sizes of the subtitles offered in the settings window (mpv's sub-scale; the local translation follows it). */
const SUB_SIZES = [
  { value: 0.8, label: "S" },
  { value: 1, label: "M" },
  { value: 1.25, label: "L" },
  { value: 1.5, label: "XL" },
];
/** The plate behind the subtitle text (kept in the player settings — the same for films and channels). */
const SUB_BACKGROUNDS: { value: SubtitleBackground; label: string }[] = [
  { value: "default", label: "Обычный" },
  { value: "none", label: "Без фона" },
  { value: "dark", label: "Плашка" },
];

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

export function TvPlayerScreen({ channelId, programme, mini = false }: { channelId: string; programme?: Programme; mini?: boolean }) {
  const minimize = useApp((s) => s.minimize);
  const expandPlayer = useApp((s) => s.expandPlayer);
  const closePlayer = useApp((s) => s.closePlayer);
  const playlist = useTv((s) => s.playlist);
  const activePlaylistId = useTv((s) => s.activePlaylistId);
  const programmesFor = useTv((s) => s.programmesFor);
  const lastArchiveFocus = useTv((s) => s.lastArchiveFocus);
  const setLastArchiveFocus = useTv((s) => s.setLastArchiveFocus);
  const epgStatus = useTv((s) => s.epgStatus);
  const back = useApp((s) => s.back);
  const replaceScreen = useApp((s) => s.replace);
  const showStreamStats = useApp((s) => s.showStreamStats);
  // The same player settings as the movie player (Settings → Плеер).
  const playerDim = useApp((s) => s.playerDim);
  const prefs = useApp((s) => s.playerPrefs);
  const channel = useMemo(() => playlist?.channels.find((c) => c.id === channelId), [playlist, channelId]);
  // Previous / next channel: within the same group (category) when the channel has one, wrapping around.
  const neighbours = useMemo(() => {
    const all = playlist?.channels ?? [];
    const list = channel?.group ? all.filter((c) => c.group === channel.group) : all;
    const i = list.findIndex((c) => c.id === channelId);
    if (i < 0 || list.length < 2) return null;
    return { prev: list[(i - 1 + list.length) % list.length], next: list[(i + 1) % list.length] };
  }, [playlist, channel, channelId]);
  const isFavChannel = useChannelFavorites(
    (s) => !!activePlaylistId && s.items.some((f) => f.playlistId === activePlaylistId && f.channel.id === channelId),
  );
  const toggleChannelFavorite = useChannelFavorites((s) => s.toggle);

  const videoRef = useRef<HTMLVideoElement>(null);
  const adapterRef = useRef<PlayerAdapter | null>(null);
  const [state, setState] = useState<PlayerState>(INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [osd, setOsd] = useState(true);
  const [sheet, setSheet] = useState<TvSheet | null>(null);
  // Rows take the focus when a window opens — not when the remote moves along its tabs.
  const [sheetAutoFocus, setSheetAutoFocus] = useState(true);
  const archiveOpen = sheet === "archive";
  const setPlayerPrefs = useApp((s) => s.setPlayerPrefs);
  const pictureInfo = usePictureInfo(adapterRef);
  // What the video is and what goes to the screen, read each time «Картинка» opens.
  useEffect(() => {
    if (sheet === "picture") void pictureInfo.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);
  const [volumeOpen, setVolumeOpen] = useState(false);
  // The level comes up when the mouse is on the volume button (and goes when it leaves), as in the trailer player; the
  // remote opens it with OK and then holds the focus in it. Only the second takes the focus.
  const [volumeByMouse, setVolumeByMouse] = useState(false);
  const volumeLeave = useRef(0);
  const nudgeVolumeRef = useRef<(d: number) => void>(() => {});
  // `offset`: seconds into the programme the archive stream starts at (it starts at its beginning when absent).
  const [archive, setArchive] = useState<{ programme: Programme; offset?: number } | null>(programme ? { programme } : null);
  // The latest "move by N seconds along the programme" (the media keys' handler lives longer than a render).
  const seekByRef = useRef<(delta: number) => void>(() => {});
  const pendingSeek = useRef<{ target: number; until: number } | null>(null);
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

  const mpvOptions = useMpvLoadOptions();

  const baseSource: PlaySource | null = useMemo(() => {
    if (!channel) return null;
    if (archive) {
      const offset = archive.offset ?? 0;
      const durationSec = Math.max(60, (archive.programme.stop - archive.programme.start) / 1000 - offset);
      const url = buildCatchupUrl(channel.url, channel.catchup, { start: new Date(archive.programme.start + offset * 1000), durationSec });
      return { url, title: `${channel.name} · ${archive.programme.title}`, live: false, mpvOptions };
    }
    return { url: channel.url, title: channel.name, live: true, mpvOptions };
  }, [channel, archive, mpvOptions]);

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
    // 0 = "don't hide": the controls stay until the viewer leaves the player.
    if (prefs.autoHideSec <= 0) return;
    hideTimer.current = window.setTimeout(() => {
      setOsd(false);
      setSheet(null);
      setVolumeOpen(false);
    }, prefs.autoHideSec * 1000);
  }, [prefs.autoHideSec]);

  // mpv renders into a native window behind a transparent hole — see useMpvReveal.
  const revealed = useMpvReveal(state.status, source);
  // Subtitles drawn by mpv itself step up over the panel while it is shown (their bottom near y 740 of 1080) and
  // go back to the edge when it hides, as the local translation does (sub-margin-y is in mpv's 720-line units).
  useEffect(() => {
    if (!isTauri || mini) return;
    void adapterRef.current?.setProp?.("sub-margin-y", osd ? "228" : "22");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osd, mini, source]);
  // The log: a player that stops on an error, and what it was playing (the host only — links carry tokens).
  useEffect(() => {
    if (state.status !== "error") return;
    let host = "";
    try {
      host = new URL(source?.url ?? "").host;
    } catch {
      /* a local path or something that isn't a URL */
    }
    logEvent("error", "player", `${state.error ?? "error"} (${host || "no url"})`);
  }, [state.status, state.error, source?.url]);
  // A press on the picture (anywhere outside the volume control) closes the volume slider.
  useCloseOnOutsidePress(volumeOpen, () => setVolumeOpen(false));

  // Discord status: the channel.
  usePresence(channel ? { details: channel.name, state: "телеканал" } : null, state.status === "playing");

  // Viewing statistics.
  useWatchTracker(
    state.status === "playing",
    channel ? { key: `tv:${channel.id}`, title: channel.name, poster: channel.logo, kind: "tv", genres: ["Телеканалы"] } : null,
  );

  useEffect(() => {
    const adapter = isTauri ? new MpvAdapter(preferredMpvAudioDevice, readFrameGeneration) : videoRef.current ? new Html5Adapter(videoRef.current) : null;
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
    if (mini) return; // a minimised player does not take Back
    return onBack(() => {
      if (volumeOpen) {
        setVolumeOpen(false);
        bump();
        return true;
      }
      if (sheet) {
        setSheet(null);
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
  }, [volumeOpen, sheet, osd, back, bump, mini]);

  useEffect(() => {
    if (mini) return; // …and does not swallow the keys of the screen the viewer is on
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Backspace") return;
      if (e.key === "AudioVolumeUp") nudgeVolumeRef.current(PLAYER_VOLUME_STEP);
      else if (e.key === "AudioVolumeDown") nudgeVolumeRef.current(-PLAYER_VOLUME_STEP);
      else if (e.key === "MediaRewind") seekByRef.current(-REMOTE_SEEK);
      else if (e.key === "MediaFastForward") seekByRef.current(REMOTE_SEEK);
      else if (e.key === "m") openSheet("audio");
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
  }, [osd, bump, mini]);

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

  // Read from the latest state, not the render the key handler was made in (see the film player).
  const togglePlay = async () => {
    const a = adapterRef.current;
    if (!a) return;
    const st = stateRef.current.status;
    if (st === "playing" || st === "buffering") await a.pause();
    else await a.play();
  };

  /** Opens a window (a second press of its button closes it); the volume level goes. */
  const openSheet = (kind: TvSheet) => {
    setVolumeOpen(false);
    setSheetAutoFocus(true);
    setSheet((cur) => (cur === kind ? null : kind));
  };
  const closeSheet = () => {
    setSheet(null);
    bump();
  };

  const toggleVolume = () => {
    setSheet(null);
    setVolumeByMouse(false);
    setVolumeOpen((v) => !v);
  };

  const selectArchive = (programme: Programme) => {
    setArchive({ programme });
    setSheet(null);
    if (channel) setLastArchiveFocus(channel.id, programme.start);
    bump();
    void setFocus("pl:play");
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
    if (live.voiceState === "ready") setTranslatorHint((h) => (h?.startsWith("Загружаю озвучку") ? null : h));
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
    // Switched off here (and no voice-over left running): no helper process stays behind.
    if (translateOn && !voiceOn) void translatorRelease("all").catch(() => undefined);
    setSheet(null);
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
    // Voice off: its server (the heaviest process) goes at once; with the subtitles off too, everything does.
    if (voiceOn) void translatorRelease(translateOn ? "voice" : "all").catch(() => undefined);
    setSheet(null);
    bump();
  };

  // A channel id that isn't in the (freshly loaded) playlist — a stale favourite whose
  // playlist has since changed, most likely. Used to render nothing at all here: a
  // silent black screen with no back button and no way to tell what went wrong.
  if (!channel) {
    return (
      <FocusGroup
        focusKey="screen:player"
        className="player kx-player"
        style={{ "--osd-dim": playerDim * 2, "--osd-scale": prefs.uiScale } as React.CSSProperties}
        isFocusBoundary
      >
        <div className="kx-osd">
          <div className="kx-scrim kx-scrim--top" />
          <div className="kx-top">
            <KxButton focusKey="pl:back" label="Назад" plate back autoFocus onPress={() => back()}>
              <KxBack />
            </KxButton>
          </div>
        </div>
        <KxError title="Канал не найден" hint="Плейлист мог измениться — выберите канал заново из списка." />
      </FocusGroup>
    );
  }

  const tracks = sheet === "audio" || sheet === "subtitle" ? state.tracks.filter((t) => t.kind === sheet) : [];
  const isPlaying = state.status === "playing";
  const nowInfo = archive ? archive.programme : guide.now;

  // The bar is the programme that is on (or the archive's): its start at the left, its end at the right. The place on
  // it is the time of the picture seen — the wall clock of now, less how far behind the live edge the viewer is. With
  // no guide for the channel it is the buffer, as it was.
  const prog = nowInfo;
  const progLen = prog ? Math.max(1, (prog.stop - prog.start) / 1000) : 0;
  const wallNow = Date.now();
  const nowSec = prog ? (wallNow - prog.start) / 1000 : 0;
  const behind = !archive && state.live && Number.isFinite(state.duration) ? Math.max(0, state.duration - state.position) : 0;
  const timeline = prog != null;
  const viewSec = !prog ? 0 : archive ? (archive.offset ?? 0) + (Number.isFinite(state.position) ? state.position : 0) : nowSec - behind;
  const progress = timeline
    ? Math.min(1, Math.max(0, viewSec / progLen))
    : Number.isFinite(state.duration) && state.duration > 0
      ? state.position / state.duration
      : 0;
  const programmeOn = prog != null && prog.start <= wallNow && wallNow < prog.stop;
  const behindLive = archive != null || behind > 10;

  const goLive = () => {
    if (archive) setArchive(null);
    else if (Number.isFinite(state.duration)) void adapterRef.current?.seek(state.duration);
    bump();
  };
  // A place on the programme's bar, in seconds from its start: the live edge if it is there, else the buffer if the
  // moment is still in it, else the channel's archive from that moment (the way back never stops at the buffer).
  const seekTimeline = (targetSec: number) => {
    const a = adapterRef.current;
    if (!a || !prog) return;
    const t = Math.min(progLen, Math.max(0, targetSec));
    if (programmeOn && t >= nowSec - 12) {
      goLive();
      return;
    }
    if (archive) {
      const inStream = t - (archive.offset ?? 0);
      if (inStream >= 0) void a.seek(inStream);
      else setArchive({ programme: archive.programme, offset: t });
      return;
    }
    const inBuffer = state.duration - (nowSec - t);
    if (Number.isFinite(state.duration) && inBuffer >= 1) void a.seek(inBuffer);
    else if (canArchive) setArchive({ programme: prog, offset: t });
    else void a.seek(0);
  };
  // Presses of "back"/"forward" that come faster than the position is reported (a held button of the remote) add up:
  // each is counted from where the last one was going, not from the position as it was on the screen a moment ago.
  const seekAlong = (delta: number) => {
    if (!timeline) {
      void adapterRef.current?.seekBy(delta);
      return;
    }
    const now = Date.now();
    const base = pendingSeek.current && now < pendingSeek.current.until ? pendingSeek.current.target : viewSec;
    const target = Math.min(progLen, Math.max(0, base + delta));
    pendingSeek.current = { target, until: now + 900 };
    seekTimeline(target);
  };
  seekByRef.current = seekAlong;

  if (mini) {
    return <MiniPlayerChrome title={channel.name} playing={isPlaying} onToggle={() => void togglePlay()} onExpand={expandPlayer} onClose={closePlayer} />;
  }

  const waiting = state.status === "loading" || state.status === "buffering" || (sessionOn && !source);
  // Where the broadcast is now on the programme's bar (a channel watched behind it, or the buffer up to it).
  const liveEdge = timeline && programmeOn && !archive ? Math.min(1, Math.max(0, nowSec / progLen)) : undefined;
  const pictureTime = prog ? timeOf(prog.start + Math.max(0, viewSec) * 1000) : fmt(state.position);
  const settingsTabs: KxTab[] = [
    { key: "audio", label: "Аудио" },
    { key: "subtitle", label: "Субтитры" },
    ...(isTauri ? [{ key: "picture", label: "Картинка" }] : []),
  ];
  const settingsOpen = sheet === "audio" || sheet === "subtitle" || sheet === "picture";

  return (
    <FocusGroup
      focusKey="screen:player"
      className={`player kx-player ${isTauri ? "player--mpv" : ""} ${revealed ? "player--revealed" : ""} ${osd ? "" : "player--idle"}`}
      style={{ "--osd-dim": playerDim * 2, "--osd-scale": prefs.uiScale } as React.CSSProperties}
      isFocusBoundary
    >
      {isTauri ? <div className="player__video-hole" /> : <video ref={videoRef} playsInline autoPlay />}

      {showStreamStats && <KxStreamStats stats={state.stats} bufferedAhead={state.bufferedAhead} extra={[["Режим", state.live ? "LIVE" : "Архив"]]} />}

      <PlayFlash status={state.status} />

      {waiting && <KxWait text={sessionOn && !live.started ? "Готовлю перевод…" : state.status === "loading" ? "Подключение…" : "Буферизация…"} />}

      <LiveSubtitles cues={live.cues} position={state.position} active={translateOn} note={translatorHint} raised={osd} />

      {state.status === "error" && (
        <KxError title="Канал недоступен" hint={state.error ?? "Проверьте подключение или попробуйте другой канал."}>
          <KxPill focusKey="pl:retry" variant="solid" autoFocus onPress={() => source && void adapterRef.current?.load(source)}>
            Повторить
          </KxPill>
          {neighbours && (
            <KxPill focusKey="pl:error-next" variant="solid" onPress={() => replaceScreen({ name: "tv-player", channelId: neighbours.next.id })}>
              Следующий канал
            </KxPill>
          )}
        </KxError>
      )}

      <div className={`kx-osd ${osd ? "" : "is-hidden"}`}>
        <div className="kx-scrim kx-scrim--top" />
        <div className="kx-scrim kx-scrim--bottom" />

        <div className="kx-top">
          <KxButton focusKey="pl:back" label="Назад" plate back onPress={() => back()}>
            <KxBack />
          </KxButton>
          <div className="kx-top__status">
            {behindLive ? (
              <>
                <span className="kx-chip kx-chip--plate">{archive ? "Архив" : `Отставание ${fmt(behind)}`}</span>
                <KxPill focusKey="pl:live" variant="solid" dot onPress={goLive}>
                  В эфир
                </KxPill>
              </>
            ) : state.live ? (
              <span className="kx-chip kx-chip--live">
                <i />
                LIVE
              </span>
            ) : (
              <span className="kx-chip kx-chip--plate">
                {fmt(state.position)} / {fmt(state.duration)}
              </span>
            )}
          </div>
        </div>

        <div className="kx-bottom">
          {nowInfo ? (
            <KxLockup
              logo={<KxChannelLogo src={channel.logo} name={channel.name} />}
              eyebrow={channel.name}
              title={nowInfo.title}
              meta={
                <>
                  {timeRange(nowInfo)}
                  {!archive && guide.next && <> · Далее: {guide.next.title}</>}
                </>
              }
            />
          ) : (
            <KxLockup logo={<KxChannelLogo src={channel.logo} name={channel.name} />} eyebrow="Прямой эфир" title={channel.name} meta="Нет данных телепрограммы" metaMuted />
          )}
          <div className="kx-seekrow">
            <span className="kx-time">{prog ? timeOf(prog.start) : state.live ? "Эфир" : fmt(state.position)}</span>
            <KxSeekBar
              focusKey="pl:seek"
              progress={progress}
              buffered={liveEdge}
              liveEdge={liveEdge}
              duration={timeline ? progLen : state.duration}
              label={pictureTime}
              seekStep={SEEK_STEP}
              onActivity={bump}
              onSeekBy={seekAlong}
              onSeekTo={(pos) => (timeline ? seekTimeline(pos) : void adapterRef.current?.seek(pos))}
            />
            <span className="kx-time kx-time--dim">{prog ? timeOf(prog.stop) : state.live ? "" : fmt(state.duration)}</span>
          </div>

          <div className="kx-controls">
            <div className="kx-controls__side">
              <KxButton focusKey="pl:audio" label="Аудиодорожка" active={sheet === "audio"} onPress={() => openSheet("audio")}>
                <KxAudio />
              </KxButton>
              <KxButton focusKey="pl:subs" label="Субтитры" active={sheet === "subtitle"} onPress={() => openSheet("subtitle")}>
                <KxSubtitles />
              </KxButton>
              {isTauri && (
                <KxButton focusKey="pl:picture" label="Картинка" active={sheet === "picture"} onPress={() => openSheet("picture")}>
                  <KxPicture />
                </KxButton>
              )}
              {activePlaylistId && (
                <KxButton
                  focusKey="pl:favorite"
                  label={isFavChannel ? "Убрать из избранного" : "В избранное"}
                  on={isFavChannel}
                  onPress={() => toggleChannelFavorite(activePlaylistId, channel)}
                >
                  <KxHeart on={isFavChannel} />
                </KxButton>
              )}
            </div>

            <div className="kx-controls__center">
              {neighbours && (
                <KxButton focusKey="pl:prev-channel" label="Предыдущий канал" onPress={() => replaceScreen({ name: "tv-player", channelId: neighbours.prev.id })}>
                  <KxPrev />
                </KxButton>
              )}
              <KxButton focusKey="pl:rew" label={`Назад на ${SEEK_STEP} с`} onPress={() => seekAlong(-SEEK_STEP)}>
                <KxRewind step={SEEK_STEP} />
              </KxButton>
              <KxButton focusKey="pl:play" label={isPlaying ? "Пауза" : "Смотреть"} large autoFocus onPress={() => void togglePlay()}>
                {isPlaying || state.status === "buffering" || state.status === "loading" ? <KxPause size={44} /> : <KxPlay size={44} />}
              </KxButton>
              <KxButton focusKey="pl:fwd" label={`Вперёд на ${SEEK_STEP} с`} onPress={() => seekAlong(SEEK_STEP)}>
                <KxForward step={SEEK_STEP} />
              </KxButton>
              {neighbours && (
                <KxButton focusKey="pl:next-channel" label="Следующий канал" onPress={() => replaceScreen({ name: "tv-player", channelId: neighbours.next.id })}>
                  <KxNext />
                </KxButton>
              )}
            </div>

            <div className="kx-controls__side kx-controls__side--right">
              {canArchive && (
                <KxButton focusKey="pl:archive" label="Архив эфира" active={archiveOpen} onPress={() => openSheet("archive")}>
                  <KxArchive />
                </KxButton>
              )}
              {isTauri && (
                <KxButton focusKey="pl:mini" label="Мини-плеер" onPress={minimize}>
                  <KxMini />
                </KxButton>
              )}
              <div
                className="volume-control"
                onMouseEnter={() => {
                  window.clearTimeout(volumeLeave.current);
                  if (osd && !volumeOpen && !sheet) {
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
                <KxButton
                  focusKey="pl:vol"
                  label={state.muted ? "Включить звук" : "Громкость"}
                  active={volumeOpen}
                  // The level is already up under the mouse: a click on the button silences or restores the sound.
                  onPress={() => (volumeOpen && volumeByMouse ? void adapterRef.current?.setMuted(!state.muted) : toggleVolume())}
                >
                  {state.muted || state.volume === 0 ? <KxMute /> : <KxVolume />}
                </KxButton>
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
                    <Focusable as="button" className="volume-popup__mute" focusKey="vol:mute" onPress={() => void adapterRef.current?.setMuted(!state.muted)} scroll={false}>
                      {state.muted ? <KxMute size={26} /> : <KxVolume size={26} />}
                    </Focusable>
                  </FocusGroup>
                )}
              </div>
              <FullscreenButton focusKey="pl:fullscreen" className="kx-btn" />
            </div>
          </div>
        </div>
      </div>

      {settingsOpen && osd && (
        <KxSheet
          focusKey="player:settings"
          preferredChildFocusKey={sheet === "picture" ? "pic:aspect" : sheet === "subtitle" ? "menu:off" : `menu:${Math.max(0, tracks.findIndex((t) => t.selected))}`}
          title={sheet === "audio" ? "Аудиодорожка" : sheet === "subtitle" ? "Субтитры" : "Картинка"}
          icon={sheet === "audio" ? <KxAudio /> : sheet === "subtitle" ? <KxSubtitles /> : <KxPicture />}
          count={sheet !== "picture" && tracks.length > 1 ? `${tracks.length} дорожек` : undefined}
          tabs={
            <KxTabs
              tabs={settingsTabs}
              current={sheet}
              prefix="tab"
              onSelect={(key) => {
                setSheetAutoFocus(false);
                setSheet(key as TvSheet);
              }}
            />
          }
          top={sheet === "picture" ? <PictureInfo info={pictureInfo.info} /> : undefined}
          footer={
            sheet === "picture" ? (
              <PictureFooter adapterRef={adapterRef} onInfo={() => void pictureInfo.refresh()} onClose={closeSheet} prefix="player:settings" />
            ) : undefined
          }
          onClose={closeSheet}
        >
          {sheet === "picture" && <PictureSettings adapterRef={adapterRef} onInfo={() => void pictureInfo.refresh()} autoFocus={sheetAutoFocus} />}

          {sheet === "subtitle" && (
            <KxRow
              focusKey="menu:off"
              label="Выключены"
              selected={!translateOn && !tracks.some((t) => t.selected)}
              autoFocus={sheetAutoFocus}
              onPress={() => {
                setWantedSub(null);
                if (translateOn) toggleTranslation();
              }}
            />
          )}
          {/* Switched off in Settings (not just not downloaded) — not offered at all. */}
          {sheet === "subtitle" && isTauri && translationEnabled && (
            <KxRow
              focusKey="menu:translate"
              label="Локальный перевод на русский"
              hint={translatorReady ? undefined : "скачайте в настройках"}
              selected={translateOn}
              onPress={toggleTranslation}
            />
          )}
          {sheet === "audio" && tracks.length === 0 && !(isTauri && translationEnabled && voiceEnabled) && <KxSheetText>Только одна дорожка</KxSheetText>}
          {(sheet === "audio" || sheet === "subtitle") &&
            tracks.map((t, i) => (
              <KxRow
                key={t.id}
                focusKey={`menu:${i}`}
                label={trackLabel(t, tracks, i)}
                selected={t.selected && !(sheet === "subtitle" && translateOn)}
                autoFocus={sheetAutoFocus && sheet === "audio" && t.selected}
                onPress={() => {
                  if (sheet === "audio") {
                    void adapterRef.current?.selectTrack("audio", t.id);
                    return;
                  }
                  // An embedded track replaces the translation — never both on screen.
                  setWantedSub(t.id);
                  if (translateOn) {
                    setTranslateOn(false);
                    closeSheet();
                  }
                }}
              />
            ))}
          {/* Voice-over is audio, so it lives in the audio list — last, after the real tracks. */}
          {sheet === "audio" && isTauri && translationEnabled && voiceEnabled && (
            <KxRow
              focusKey="menu:voice"
              label="AI-переводчик"
              hint={!voiceReady ? "скачайте в настройках" : voiceOn && live.voiceState === "starting" ? "загружается…" : undefined}
              selected={voiceOn}
              onPress={toggleVoice}
            />
          )}
          {sheet === "subtitle" && (
            <>
              <KxSheetLabel>Вид субтитров</KxSheetLabel>
              <KxSegmentRow
                focusKey="menu:sub-size"
                label="Размер"
                options={SUB_SIZES}
                value={SUB_SIZES.reduce((best, o) => (Math.abs(o.value - prefs.subtitleScale) < Math.abs(best.value - prefs.subtitleScale) ? o : best), SUB_SIZES[1]).value}
                onChange={(v) => {
                  setPlayerPrefs({ subtitleScale: v });
                  void adapterRef.current?.setProp?.("sub-scale", String(v));
                }}
              />
              <KxSegmentRow
                focusKey="menu:sub-bg"
                label="Фон"
                options={SUB_BACKGROUNDS}
                value={prefs.subtitleBackground}
                onChange={(v) => {
                  setPlayerPrefs({ subtitleBackground: v });
                  void applySubtitleBackground(adapterRef.current, v);
                }}
              />
            </>
          )}
        </KxSheet>
      )}

      {archiveOpen && osd && (
        <KxSheet
          focusKey="player:archive"
          title="Архив эфира"
          icon={<KxArchive />}
          count={`за ${channel.catchup?.days ?? DEFAULT_CATCHUP_DAYS} дн.`}
          onClose={closeSheet}
          onBodyScroll={(el) => {
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) loadMoreArchive();
          }}
        >
          {archiveDays.length === 0 && <KxSheetText>Нет данных программы за доступный период архива</KxSheetText>}
          {visibleArchiveDays.map((day, di) => (
            <div key={day.key} className="kx-sheet__group">
              <KxSheetLabel>{day.label}</KxSheetLabel>
              {day.items.map((p, i) => {
                const isLastRendered = di === visibleArchiveDays.length - 1 && i === day.items.length - 1;
                return (
                  <KxStackRow
                    key={`${day.key}:${i}`}
                    focusKey={`arch:${day.key}:${i}`}
                    time={timeRange(p)}
                    title={p.title}
                    selected={archive?.programme.start === p.start}
                    onPress={() => selectArchive(p)}
                    onFocus={isLastRendered && archiveVisible < archiveTotal ? loadMoreArchive : undefined}
                    autoFocus={rememberedArchiveVisible ? p.start === lastArchiveFocus[channel.id] : di === 0 && i === 0}
                    toClose="player:archive:close"
                  />
                );
              })}
            </div>
          ))}
          {archiveVisible < archiveTotal && <KxSheetText>Загрузка ещё…</KxSheetText>}
        </KxSheet>
      )}
    </FocusGroup>
  );
}
