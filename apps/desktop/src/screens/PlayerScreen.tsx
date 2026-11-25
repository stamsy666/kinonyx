import { invoke } from "@tauri-apps/api/core";
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
  type PlaySource,
  type Track,
  type ExtraTrack,
} from "@kinonyx/player-core";
import { DownloadIcon, FocusGroup, Focusable, onBack, Spinner } from "@kinonyx/ui";
import { useApp, type SubtitleBackground } from "../store/app";
import { PictureFooter, PictureInfo, PictureSettings, usePictureInfo } from "../components/PicturePanel";
import { EpisodesSheet } from "../components/player/EpisodesSheet";
import { applySubtitleBackground, PLAYER_VOLUME_STEP, readFrameGeneration, useMpvLoadOptions } from "../data/playerOptions";
import { useTranslator } from "../store/translator";
import { translatorRelease } from "../data/translator";
import { LiveSubtitles, useFilmTranslation } from "../components/LiveSubtitles";
import { useContinueWatching } from "../store/continueWatching";
import { isTauri } from "../data/io";
import { episodeKey, episodeLabel } from "../data/episodes";
import type { YoutubeAuthor, YoutubePlayback } from "../data/youtube";
import { trackYoutubeProgress, youtubeResumePosition } from "../data/youtubeProgress";
import { preferredMpvAudioDevice } from "../data/audioDevices";
import { trackLabel } from "../data/trackLabel";
import { useWatchTracker } from "../components/useWatchTracker";
import { usePresence } from "../components/usePresence";
import { useEpisodeProgress } from "../store/episodeProgress";
import { enqueueYoutubeDownload } from "../store/downloads";
import { streamUrlFor, torrentSwarmStats, type SwarmStats, type TorrentFile, type TrailerQuality } from "../data/api";
import { PlayFlash } from "../components/PlayFlash";
import { useMpvReveal } from "../components/useMpvReveal";
import { VolumeSlider } from "../components/VolumeSlider";
import { FullscreenButton } from "../components/FullscreenButton";
import { MiniPlayerChrome, useCloseOnOutsidePress } from "../components/MiniPlayer";
import { KxSeekBar } from "../components/player/KxSeekBar";
import { KxButton, KxChannelLogo, KxError, KxLockup, KxPill, KxStreamStats, KxWait } from "../components/player/PlayerChrome";
import { KxRow, KxSegmentRow, KxSheet, KxSheetLabel, KxSheetText, KxTabs, type KxTab } from "../components/player/PlayerSheet";
import {
  KxAudio,
  KxBack,
  KxEpisodes,
  KxForward,
  KxHd,
  KxMini,
  KxMute,
  KxNext,
  KxPause,
  KxPicture,
  KxPlay,
  KxRewind,
  KxSkip,
  KxSubtitles,
  KxVolume,
} from "../components/player/PlayerIcons";

const SEEK_STEP = 15;
const OPENING_CREDITS_END = 30;

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
/** The windows of the player: the settings (three tabs), the episodes, the trailer's quality. */
type Sheet = "audio" | "subtitle" | "picture" | "episodes" | "quality" | "download";

type YoutubeSave = { status: "busy" | "saved" | "failed"; message: string };

/** Sizes of the subtitles offered in the settings window (mpv's sub-scale; the local translation follows it). */
const SUB_SIZES = [
  { value: 0.8, label: "S" },
  { value: 1, label: "M" },
  { value: 1.25, label: "L" },
  { value: 1.5, label: "XL" },
];
/** The plate behind the subtitle text (Settings → Плеер keeps it for films, series and channels alike). */
const SUB_BACKGROUNDS: { value: SubtitleBackground; label: string }[] = [
  { value: "default", label: "Обычный" },
  { value: "none", label: "Без фона" },
  { value: "dark", label: "Плашка" },
];

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function PlayerScreen({
  title,
  url,
  qualities,
  qualityIndex,
  provider,
  youtube,
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
  provider?: "youtube";
  youtube?: YoutubePlayback;
  hash?: string;
  filmId?: number;
  film?: { nameRu?: string; nameOriginal?: string; year?: string | number; genres?: string[] };
  poster?: string;
  episodes?: EpisodeQueue;
  /** Subtitles and sound tracks that came in the release beside the video. */
  extras?: ExtraTrack[];
}) {
  const back = useApp((s) => s.back);
  const navigate = useApp((s) => s.navigate);
  const replace = useApp((s) => s.replace);
  const minimize = useApp((s) => s.minimize);
  const expandPlayer = useApp((s) => s.expandPlayer);
  const closePlayer = useApp((s) => s.closePlayer);
  const showStreamStats = useApp((s) => s.showStreamStats);
  const playerDim = useApp((s) => s.playerDim);
  const prefs = useApp((s) => s.playerPrefs);
  const [authorDetails, setAuthorDetails] = useState<YoutubeAuthor | null>(null);
  const authorId = youtube?.author.id;
  const hasAuthorAvatar = !!youtube?.author.avatar;
  useEffect(() => {
    if (!isTauri || !authorId || hasAuthorAvatar) return;
    let current = true;
    void invoke<YoutubeAuthor>("youtube_author", { id: authorId }).then((details) => {
      if (current) setAuthorDetails(details);
    }, () => {});
    return () => { current = false; };
  }, [authorId, hasAuthorAvatar]);
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
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [youtubeSave, setYoutubeSave] = useState<YoutubeSave | null>(null);
  const savePending = useRef(false);
  // Rows take the focus when a window opens — not when the remote moves along its tabs.
  const [sheetAutoFocus, setSheetAutoFocus] = useState(true);
  const [volumeOpen, setVolumeOpen] = useState(false);
  // The level comes up when the mouse is on the volume button (and goes when it leaves); the remote opens it with OK
  // and then holds the focus in it. Only the second takes the focus.
  const [volumeByMouse, setVolumeByMouse] = useState(false);
  const volumeLeave = useRef(0);
  const nudgeVolumeRef = useRef<(d: number) => void>(() => {});

  const hideTimer = useRef<number>(0);

  // Trailers come with a list of qualities; switching one reloads the stream and resumes
  // from where it was (mpv's per-title `start` option).
  const [qIdx, setQIdx] = useState(qualityIndex ?? 0);
  const youtubeProgressId = youtube?.live ? undefined : youtube?.videoId;
  const [resumeAt, setResumeAt] = useState(() => youtubeProgressId ? youtubeResumePosition(youtubeProgressId) : 0);
  const quality = qualities?.[qIdx];
  const curUrl = quality?.url ?? url;
  const curAudio = quality?.audioUrl ?? undefined;
  const pictureOptions = useMpvLoadOptions();
  const source: PlaySource = useMemo(() => {
    const mpvOptions: Record<string, string> = {};
    if (curAudio) mpvOptions["audio-files"] = curAudio;
    if (quality?.hlsBitrate) mpvOptions["hls-bitrate"] = String(quality.hlsBitrate);
    if (provider === "youtube") {
      mpvOptions.alang = "ru";
      mpvOptions["cache-pause-initial"] = "no";
      mpvOptions["cache-pause-wait"] = "1";
      // Inline manifests lack a .m3u8 extension for FFmpeg's format probe.
      if (curUrl.startsWith("memory://#EXTM3U\n")) mpvOptions["demuxer-lavf-format"] = "hls";
    }
    // The player settings (subtitles, night mode, scaling, HDR…) are mpv options set before each load.
    Object.assign(mpvOptions, pictureOptions);
    return {
      url: curUrl,
      title,
      live: youtube?.live ?? false,
      startPosition: !youtube?.live && resumeAt >= 1 ? Math.floor(resumeAt) : undefined,
      mpvOptions,
      extraTracks: extras,
      ...(referer ? { headers: { Referer: referer }, userAgent: BROWSER_UA } : {}),
    };
  }, [curUrl, curAudio, quality?.hlsBitrate, provider, youtube?.live, title, resumeAt, pictureOptions, extras, referer]);

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
  const filmInfo = useMemo(
    () => ({ id: filmId, title, nameRu: film?.nameRu, nameOriginal: film?.nameOriginal }),
    [filmId, title, film?.nameRu, film?.nameOriginal],
  );
  const filmSubs = useFilmTranslation(canTranslate ? curUrl : null, filmTr, state.position, filmInfo);
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
      setSheet(null);
      setVolumeOpen(false);
    }, prefs.autoHideSec * 1000);
  };

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
      host = new URL(source.url).host;
    } catch {
      /* a local path or something that isn't a URL */
    }
    logEvent("error", "player", `${state.error ?? "error"} (${host || "no url"})`);
  }, [state.status, state.error, source.url]);

  // External tracks can arrive after the first track list, especially on a new episode.
  useEffect(() => {
    if (!filmId || state.tracks.length === 0) return;
    const saved = getTrackPrefs(filmId);
    const a = adapterRef.current;
    if (!a) return;
    const audio = saved?.audio && matchTrack(state.tracks.filter((t) => t.kind === "audio"), saved.audio);
    if (audio && !audio.selected) void a.selectTrack("audio", audio.id);
    if (filmTr || saved?.subtitle === "off") {
      if (state.tracks.some((t) => t.kind === "subtitle" && t.selected)) void a.selectTrack("subtitle", null);
    } else if (saved?.subtitle) {
      const sub = matchTrack(state.tracks.filter((t) => t.kind === "subtitle"), saved.subtitle);
      if (sub && !sub.selected) void a.selectTrack("subtitle", sub.id);
    }
  }, [filmId, filmTr, source.url, state.tracks]);
  // A press on the picture (anywhere outside the volume control) closes the volume slider.
  useCloseOnOutsidePress(volumeOpen, () => setVolumeOpen(false));

  // Episode of a series pack being played — progress is kept per episode (see store/episodeProgress.ts).
  const epKey = episodes ? episodeKey(episodes.files[episodes.index]) : null;

  // "Skip intro": the file's own chapter marks first; in a series, also the stretch the viewer jumped over in an
  // earlier episode (learned from their own seeking, nothing to mark by hand).
  const learnedIntro = useMemo(() => (filmId && episodes ? getLearnedIntro(filmId) : undefined), [filmId, episodes, source.url]);
  const hasNextEpisode = !!episodes && episodes.index < episodes.files.length - 1;
  const canSkip = !!filmId && state.status !== "error" && state.status !== "ended" && prefs.skipMode !== "off";
  const rawSkip =
    !canSkip
      ? null
      : findSkip({ chapters: state.chapters, learned: learnedIntro, position: state.position, duration: state.duration, series: !!episodes, hasNext: hasNextEpisode });
  const [openingCreditsSkipped, setOpeningCreditsSkipped] = useState(false);
  const showOpeningCredits = !mini && canSkip && !openingCreditsSkipped && state.duration > OPENING_CREDITS_END
    && state.position >= 0 && state.position < OPENING_CREDITS_END;
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
    else void adapterRef.current?.seek(target.to, true);
  };
  const skipCreditsRef = useRef<() => void>(() => {});
  skipCreditsRef.current = () => {
    const adapter = adapterRef.current;
    if (!showOpeningCredits || !adapter) return;
    setOpeningCreditsSkipped(true);
    skippedByButton.current = true;
    void adapter.seek(OPENING_CREDITS_END, true);
    bump();
    setFocus("pl:play");
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
  const skipFocus = skipTarget && state.position >= OPENING_CREDITS_END ? "player:skip" : null;
  useEffect(() => {
    if (!skipFocus || sheet || mini) return;
    const timer = window.setTimeout(() => setFocus(skipFocus), 50);
    return () => window.clearTimeout(timer);
  }, [skipFocus, sheet, mini]);

  // Discord status: the film (and episode) being watched. Trailers show as such.
  usePresence(
    {
      details: film?.nameRu || film?.nameOriginal || title,
      state: provider === "youtube" ? "YouTube" : filmId ? (epKey ? episodeLabel(epKey, "сериал") : "фильм") : "трейлер",
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
    setSheet(null);
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
    const adapter = isTauri ? new MpvAdapter(preferredMpvAudioDevice, readFrameGeneration) : videoRef.current ? new Html5Adapter(videoRef.current) : null;
    if (!adapter) return;
    adapterRef.current = adapter;
    const progress = youtubeProgressId ? trackYoutubeProgress(youtubeProgressId) : null;
    const unsub = adapter.subscribe((next) => {
      progress?.update(next);
      setState(next);
    });
    if (progress) window.addEventListener("pagehide", progress.flush);
    return () => {
      unsub();
      if (progress) {
        window.removeEventListener("pagehide", progress.flush);
        progress.flush();
      }
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [youtubeProgressId]);

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
  }, [volumeOpen, sheet, osd, back, mini]);

  useEffect(() => {
    if (mini) return; // …and does not swallow the keys of the screen the viewer is on
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Backspace") return;
      const a = adapterRef.current;
      if (e.key === "AudioVolumeUp") nudgeVolumeRef.current(PLAYER_VOLUME_STEP);
      else if (e.key === "AudioVolumeDown") nudgeVolumeRef.current(-PLAYER_VOLUME_STEP);
      else if (e.key === "MediaRewind") void a?.seekBy(-SEEK_STEP);
      else if (e.key === "MediaFastForward") void a?.seekBy(SEEK_STEP);
      else if ((e.key === "s" || e.key === "S") && filmId) skipCreditsRef.current();
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

  /** Opens a window (a second press of its button closes it); the volume level goes. */
  const openSheet = (kind: Sheet) => {
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

  const pickQuality = (index: number) => {
    setSheet(null);
    if (index === qIdx) return;
    setResumeAt(youtube?.live ? 0 : state.position);
    setQIdx(index);
  };

  const downloadVideo = async (height?: number) => {
    if (!youtube || youtube.live || savePending.current) return;
    savePending.current = true;
    setYoutubeSave({ status: "busy", message: "Прогресс можно отслеживать в разделе «Загрузки»." });
    requestAnimationFrame(() => void setFocus("player:download:close", { skipScroll: true }));
    try {
      const saved = await enqueueYoutubeDownload({ videoId: youtube.videoId, title, quality: height });
      if (!saved) {
        setYoutubeSave(null);
        return;
      }
      const resolution = saved.height ? ` · ${saved.height}p` : "";
      setYoutubeSave({ status: "saved", message: `${saved.fileName}${resolution}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setYoutubeSave({ status: "failed", message });
    } finally {
      savePending.current = false;
    }
  };

  const isPlaying = state.status === "playing";
  const waiting = state.status === "loading" || state.status === "buffering";
  const hasDuration = Number.isFinite(state.duration) && state.duration > 0;
  const progress = hasDuration ? state.position / state.duration : 0;
  const buffered = hasDuration ? (state.position + state.bufferedAhead) / state.duration : 0;
  const marks = hasDuration ? (state.chapters ?? []).map((c) => c.start / state.duration) : [];
  // A trailer (no film id): a simpler panel — no tracks, picture or mini window, the quality in words.
  const isTrailer = !filmId && !provider;
  const downloadHeights = [...new Set(qualities?.map((item) => item.height))].sort((a, b) => b - a);
  const downloadChoices = downloadHeights.length ? downloadHeights : [undefined];
  const preferredDownloadHeight = quality?.height ?? downloadChoices[0];
  const shownTitle = film?.nameRu || film?.nameOriginal || title;
  const author = authorDetails?.name || youtube?.author.name;
  const avatar = authorDetails?.avatar || youtube?.author.avatar;
  const canSeek = !youtube?.live || hasDuration;
  const eyebrow = provider === "youtube" ? undefined : isTrailer
    ? "Трейлер"
    : epKey
      ? episodeLabel(epKey, title)
      : [film?.year, film?.genres?.slice(0, 2).join(", ")].filter(Boolean).join(" · ");

  if (mini) {
    return <MiniPlayerChrome title={title} playing={isPlaying} onToggle={() => void togglePlay()} onExpand={expandPlayer} onClose={closePlayer} />;
  }

  const settingsTabs: KxTab[] = [
    { key: "audio", label: "Аудио" },
    { key: "subtitle", label: "Субтитры" },
    ...(isTauri ? [{ key: "picture", label: "Картинка" }] : []),
  ];
  const settingsOpen = sheet === "audio" || sheet === "subtitle" || sheet === "picture";
  const sheetTracks = sheet === "audio" || sheet === "subtitle" ? state.tracks.filter((t) => t.kind === sheet) : [];
  const selectedTrack = sheetTracks.findIndex((t) => t.selected);
  const subtitleOff = !filmTr && !sheetTracks.some((t) => t.selected);

  return (
    <FocusGroup
      focusKey="screen:player"
      className={`player kx-player ${provider === "youtube" ? "kx-player--youtube" : ""} ${isTauri ? "player--mpv" : ""} ${revealed ? "player--revealed" : ""} ${osd ? "" : "player--idle"}`}
      style={{ "--osd-dim": playerDim * 2, "--osd-scale": prefs.uiScale } as React.CSSProperties}
      isFocusBoundary
    >
      {isTauri ? <div className="player__video-hole" /> : <video ref={videoRef} playsInline autoPlay />}

      <LiveSubtitles cues={filmSubs.cues} position={state.position} active={filmTr} note={trHint} raised={osd} />

      {showStreamStats && (
        <KxStreamStats
          stats={state.stats}
          bufferedAhead={state.bufferedAhead}
          extra={
            swarm
              ? [
                  ["Загрузка", `${((swarm.downloadSpeed * 8) / 1e6).toFixed(1)} Мбит/с`],
                  ["Пиры", `${swarm.activePeers} из ${swarm.totalPeers}`],
                  ["Сиды", String(swarm.seeders)],
                ]
              : undefined
          }
        />
      )}

      <PlayFlash status={state.status} />

      {waiting && <KxWait text={state.status === "loading" ? "Подключение…" : "Буферизация…"} />}

      {state.status === "error" && (
        <KxError title="Не удалось воспроизвести" hint={state.error ?? "Попробуйте ещё раз или выберите другую раздачу."}>
          <KxPill focusKey="pl:retry" variant="solid" autoFocus onPress={() => void adapterRef.current?.load(source)}>
            Повторить
          </KxPill>
          <KxPill focusKey="pl:error-back" variant="solid" onPress={() => back()}>
            Назад
          </KxPill>
        </KxError>
      )}

      <div className={`kx-osd ${osd ? "" : "is-hidden"}`}>
        <div className="kx-scrim kx-scrim--top" />
        <div className="kx-scrim kx-scrim--bottom" />

        <div className="kx-top">
          <KxButton focusKey="pl:back" label="Назад" plate back onPress={() => back()}>
            <KxBack />
          </KxButton>
        </div>

        <div className="kx-bottom">
          <KxLockup eyebrow={eyebrow || undefined} title={shownTitle} aboveTitle={youtube && (
            <div className="kx-youtube-byline">
              {authorId ? (
                <KxPill focusKey="pl:author" variant="solid" icon={<KxChannelLogo src={avatar} name={author || "Канал"} />}
                  onPress={() => {
                    closePlayer();
                    navigate({ name: "youtube", channel: { id: authorId, name: author || "", avatar } });
                  }}>
                  {author || "Открыть канал"}
                </KxPill>
              ) : author && <p className="kx-eyebrow">{author}</p>}
              {youtube.live && <span className="kx-chip kx-chip--live"><i />В эфире</span>}
            </div>
          )} />
          {canSeek && <div className="kx-seekrow">
            <span className="kx-time">{fmt(state.position)}</span>
            <KxSeekBar
              focusKey="pl:seek"
              progress={progress}
              buffered={buffered}
              marks={marks}
              duration={state.duration}
              label={fmt(state.position)}
              seekStep={SEEK_STEP}
              onActivity={bump}
              onSeekBy={(delta) => void adapterRef.current?.seekBy(delta)}
              onSeekTo={(pos) => void adapterRef.current?.seek(pos)}
            />
            <span className="kx-time kx-time--dim">{youtube?.live ? "Эфир" : fmt(state.duration)}</span>
          </div>}

          <div className="kx-controls">
            <div className="kx-controls__side">
              {!isTrailer && (
                <>
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
                </>
              )}
              {episodes && episodes.files.length > 1 && (
                <KxButton focusKey="pl:episodes" label="Серии" active={sheet === "episodes"} onPress={() => openSheet("episodes")}>
                  <KxEpisodes />
                </KxButton>
              )}
              {isTauri && youtube && !youtube.live && (
                <KxButton focusKey="pl:download" label="Скачать видео" active={sheet === "download" || youtubeSave?.status === "busy"}
                  onPress={() => {
                    if (!savePending.current) setYoutubeSave(null);
                    openSheet("download");
                  }}>
                  <DownloadIcon size={26} />
                </KxButton>
              )}
            </div>

            <div className="kx-controls__center">
              {canSeek && <KxButton focusKey="pl:rew" label={`Назад на ${SEEK_STEP} с`} onPress={() => void adapterRef.current?.seekBy(-SEEK_STEP)}>
                <KxRewind step={SEEK_STEP} />
              </KxButton>}
              <KxButton focusKey="pl:play" label={isPlaying ? "Пауза" : "Смотреть"} large autoFocus onPress={() => void togglePlay()}>
                {isPlaying || state.status === "buffering" || state.status === "loading" ? <KxPause size={44} /> : <KxPlay size={44} />}
              </KxButton>
              {canSeek && <KxButton focusKey="pl:fwd" label={`Вперёд на ${SEEK_STEP} с`} onPress={() => void adapterRef.current?.seekBy(SEEK_STEP)}>
                <KxForward step={SEEK_STEP} />
              </KxButton>}
              {nextEpisode && (
                <KxButton focusKey="pl:next-episode" label="Следующая серия" onPress={goToNextEpisode}>
                  <KxNext />
                </KxButton>
              )}
            </div>

            <div className="kx-controls__side kx-controls__side--right">
              {showOpeningCredits && (
                <KxPill focusKey="pl:credits" icon={<KxSkip />} onPress={() => skipCreditsRef.current()}>
                  Пропустить титры
                </KxPill>
              )}
              {qualities && (provider === "youtube" || qualities.length > 1) && (
                <KxPill focusKey="pl:quality" icon={<KxHd />} onPress={() => openSheet("quality")}>
                  {quality ? `${quality.height}p` : "Качество"}
                </KxPill>
              )}
              {isTauri && !isTrailer && (
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
        <FilmSettingsSheet
          tab={sheet}
          tabs={settingsTabs}
          autoFocusRows={sheetAutoFocus}
          onTab={(key) => {
            setSheetAutoFocus(false);
            setSheet(key as Sheet);
          }}
          onClose={closeSheet}
          adapterRef={adapterRef}
          tracks={sheetTracks}
          selectedTrack={selectedTrack}
          subtitleOff={subtitleOff}
          canTranslate={canTranslate}
          translatorReady={translatorReady}
          filmTr={filmTr}
          onTrack={(t) => {
            const kind = sheet === "subtitle" ? "subtitle" : "audio";
            // An embedded track replaces the translation — never both on screen.
            if (kind === "subtitle") turnTranslationOff();
            void adapterRef.current?.selectTrack(kind, t.id);
            if (filmId) rememberTrack(filmId, kind, t);
          }}
          onSubtitlesOff={() => {
            turnTranslationOff();
            void adapterRef.current?.selectTrack("subtitle", null);
            if (filmId) rememberTrack(filmId, "subtitle", null);
          }}
          onTranslate={() => {
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
            closeSheet();
          }}
        />
      )}

      {sheet === "quality" && osd && qualities && (
        <KxSheet focusKey="player:quality" preferredChildFocusKey={`q:${qIdx}`} title="Качество" icon={<KxHd />} fit onClose={closeSheet}>
          {[...qualities.keys()].reverse().map((i) => (
            <KxRow
              key={qualities[i].height}
              focusKey={`q:${i}`}
              label={`${qualities[i].height}p`}
              hint={qualities[i].height >= 2160 ? "4K" : qualities[i].height >= 1080 ? "HD" : undefined}
              selected={i === qIdx}
              onPress={() => pickQuality(i)}
              autoFocus={i === qIdx}
            />
          ))}
        </KxSheet>
      )}

      {sheet === "download" && osd && (
        <KxSheet focusKey="player:download" preferredChildFocusKey={youtubeSave ? "player:download:close" : "dlq:" + preferredDownloadHeight}
          title={youtubeSave?.status === "saved" ? "Видео скачано" : youtubeSave?.status === "failed" ? "Ошибка загрузки" : youtubeSave?.status === "busy" ? "Загрузка видео" : "Качество загрузки"}
          icon={youtubeSave?.status === "busy" ? <Spinner /> : <DownloadIcon />} fit onClose={closeSheet}>
          {youtubeSave ? <KxSheetText>{youtubeSave.message}</KxSheetText> : downloadChoices.map((height) => (
            <KxRow key={height ?? "auto"} focusKey={"dlq:" + height} label={height ? `${height}p` : "Авто (до 1080p)"}
              selected={height === preferredDownloadHeight} autoFocus={height === preferredDownloadHeight}
              onPress={() => void downloadVideo(height)} />
          ))}
        </KxSheet>
      )}

      {sheet === "episodes" && osd && episodes && (
        <EpisodesSheet
          files={episodes.files}
          current={episodes.index}
          filmId={filmId}
          poster={poster}
          onPick={(index) => void goToEpisode(index)}
          onClose={closeSheet}
        />
      )}

      {skipTarget && autoNext === null && (
        <Focusable as="button" className="kx-skip" focusKey="player:skip" scroll={false} onPress={() => skipNow()}>
          <i
            className="kx-skip__left"
            style={{ transform: `scaleX(${Math.max(0, Math.min(1, (skipTarget.end - state.position) / Math.max(1, skipTarget.end - skipTarget.from)))})` }}
          />
          <KxSkip size={26} />
          <span>{skipTarget.label}</span>
        </Focusable>
      )}
      {skipAnnounce && !skipTarget && autoNext === null && (
        <div className="kx-skip kx-skip--note" role="status">
          <span>{skipAnnounce.phase === "inside" ? (skipAnnounce.toNext ? "Следующая серия…" : "Пропускаю…") : skipAnnounce.label}</span>
        </div>
      )}

      {autoNext !== null && nextEpisode && (
        <div className="kx-autonext" role="status">
          <p className="kx-eyebrow">Следующая серия через {autoNext} с</p>
          <p className="kx-autonext__name">{episodeLabel(episodeKey(nextEpisode), nextEpisode.name)}</p>
          <div className="kx-autonext__bar">
            <i style={{ transform: `scaleX(${1 - autoNext / AUTO_NEXT_SECS})` }} />
          </div>
          <div className="kx-autonext__actions">
            <KxPill
              focusKey="autonext:now"
              variant="solid"
              icon={<KxPlay size={24} />}
              autoFocus
              onPress={() => {
                setAutoNext(null);
                goToNextEpisode();
              }}
            >
              Смотреть сейчас
            </KxPill>
            <KxPill
              focusKey="autonext:cancel"
              variant="solid"
              onPress={() => {
                autoNextCancelled.current = true;
                setAutoNext(null);
              }}
            >
              Отмена
            </KxPill>
          </div>
        </div>
      )}
    </FocusGroup>
  );
}

/** The film player's settings window: Аудио · Субтитры · Картинка as tabs of one panel. */
function FilmSettingsSheet({
  tab,
  tabs,
  autoFocusRows,
  onTab,
  onClose,
  adapterRef,
  tracks,
  selectedTrack,
  subtitleOff,
  canTranslate,
  translatorReady,
  filmTr,
  onTrack,
  onSubtitlesOff,
  onTranslate,
}: {
  tab: Sheet;
  tabs: KxTab[];
  autoFocusRows: boolean;
  onTab: (key: string) => void;
  onClose: () => void;
  adapterRef: React.MutableRefObject<PlayerAdapter | null>;
  tracks: Track[];
  selectedTrack: number;
  subtitleOff: boolean;
  canTranslate: boolean;
  translatorReady: boolean;
  filmTr: boolean;
  onTrack: (t: Track) => void;
  onSubtitlesOff: () => void;
  onTranslate: () => void;
}) {
  const prefs = useApp((s) => s.playerPrefs);
  const setPlayerPrefs = useApp((s) => s.setPlayerPrefs);
  const { info, refresh } = usePictureInfo(adapterRef);
  const head =
    tab === "audio"
      ? { title: "Аудиодорожка", icon: <KxAudio /> }
      : tab === "subtitle"
        ? { title: "Субтитры", icon: <KxSubtitles /> }
        : { title: "Картинка", icon: <KxPicture /> };
  const preferred = tab === "picture" ? "pic:aspect" : tab === "subtitle" ? "menu:off" : `menu:${Math.max(0, selectedTrack)}`;
  const count = tab !== "picture" && tracks.length > 1 ? `${tracks.length} дорожек` : undefined;
  const subSize = SUB_SIZES.reduce((best, o) => (Math.abs(o.value - prefs.subtitleScale) < Math.abs(best.value - prefs.subtitleScale) ? o : best), SUB_SIZES[1]);

  return (
    <KxSheet
      focusKey="player:settings"
      preferredChildFocusKey={preferred}
      title={head.title}
      icon={head.icon}
      count={count}
      tabs={<KxTabs tabs={tabs} current={tab} onSelect={onTab} prefix="tab" />}
      top={tab === "picture" ? <PictureInfo info={info} /> : undefined}
      footer={tab === "picture" ? <PictureFooter adapterRef={adapterRef} onInfo={() => void refresh()} onClose={onClose} prefix="player:settings" /> : undefined}
      onClose={onClose}
    >
      {tab === "picture" && <PictureSettings adapterRef={adapterRef} onInfo={() => void refresh()} autoFocus={autoFocusRows} />}

      {tab === "audio" && tracks.length === 0 && <KxSheetText>Только одна дорожка</KxSheetText>}

      {tab === "subtitle" && (
        <KxRow focusKey="menu:off" label="Выключены" selected={subtitleOff} onPress={onSubtitlesOff} autoFocus={autoFocusRows} />
      )}
      {tab === "subtitle" && canTranslate && (
        <KxRow
          focusKey="menu:translate"
          label="Локальный перевод на русский"
          hint={translatorReady ? undefined : "скачайте в настройках"}
          selected={filmTr}
          onPress={onTranslate}
        />
      )}
      {(tab === "audio" || tab === "subtitle") &&
        tracks.map((t, i) => (
          <KxRow
            key={t.id}
            focusKey={`menu:${i}`}
            label={trackLabel(t, tracks, i)}
            selected={t.selected && !(tab === "subtitle" && filmTr)}
            onPress={() => onTrack(t)}
            autoFocus={autoFocusRows && tab === "audio" && i === Math.max(0, selectedTrack)}
          />
        ))}
      {tab === "subtitle" && (
        <>
          <KxSheetLabel>Вид субтитров</KxSheetLabel>
          <KxSegmentRow
            focusKey="menu:sub-size"
            label="Размер"
            options={SUB_SIZES}
            value={subSize.value}
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
  );
}
