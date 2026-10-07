import Hls, { type ErrorData } from "hls.js";
import { StateStore } from "./state-store";
import type { PlaySource, PlayerAdapter, PlayerState, PlayerStats, StateListener, Track, TrackKind } from "./types";

const HLS_RE = /\.m3u8(\?|$)/i;

/**
 * Browser adapter: HTMLVideoElement + hls.js. Used by the web dev-preview and as the
 * desktop fallback whenever the app isn't running inside real Tauri. Only plays what the
 * browser can decode (HLS/MP4 with H.264/AAC etc.) — the mpv adapter is what actually
 * plays torrent/Torrserve streams with full codec support.
 */
const STATS_SAMPLE_MS = 1000;

export class Html5Adapter implements PlayerAdapter {
  readonly name = "html5";
  private store = new StateStore();
  private hls: Hls | null = null;
  private detach: (() => void) | null = null;
  private statsTimer: number | null = null;
  private lastQuality: { frames: number; at: number } | null = null;

  constructor(private video: HTMLVideoElement) {
    this.attachVideoEvents();
    this.store.patch({ volume: video.volume, muted: video.muted });
    this.startStatsSampler();
  }

  private attachVideoEvents() {
    const v = this.video;
    const on = <K extends keyof HTMLVideoElementEventMap>(ev: K, fn: () => void) => {
      v.addEventListener(ev, fn);
      return () => v.removeEventListener(ev, fn);
    };
    const offs = [
      on("playing", () => this.store.patch({ status: "playing" })),
      on("pause", () => this.store.patch({ status: "paused" })),
      on("waiting", () => this.store.patch({ status: "buffering" })),
      on("ended", () => this.store.patch({ status: "ended" })),
      on("timeupdate", () => this.syncTime()),
      on("durationchange", () => this.syncTime()),
      on("progress", () => this.syncTime()),
      on("resize", () => this.syncStats()),
      on("volumechange", () => this.store.patch({ volume: v.volume, muted: v.muted })),
      on("error", () => {
        if (!this.hls) this.store.patch({ status: "error", error: v.error?.message ?? "Ошибка воспроизведения" });
      }),
    ];
    this.detach = () => offs.forEach((off) => off());
  }

  /** Real, presented-frame FPS (not just the stream's advertised rate) via getVideoPlaybackQuality. */
  private startStatsSampler() {
    if (typeof this.video.getVideoPlaybackQuality !== "function") return;
    this.lastQuality = null;
    this.statsTimer = window.setInterval(() => this.syncStats(), STATS_SAMPLE_MS);
  }

  private syncStats() {
    const v = this.video;
    const patch: Partial<PlayerStats> = {
      width: v.videoWidth || undefined,
      height: v.videoHeight || undefined,
    };
    if (typeof v.getVideoPlaybackQuality === "function") {
      const q = v.getVideoPlaybackQuality();
      const now = performance.now();
      if (this.lastQuality) {
        const dtSec = (now - this.lastQuality.at) / 1000;
        const dFrames = q.totalVideoFrames - this.lastQuality.frames;
        if (dtSec > 0 && dFrames >= 0) patch.fps = Math.round(dFrames / dtSec);
      }
      this.lastQuality = { frames: q.totalVideoFrames, at: now };
      patch.droppedFrames = q.droppedVideoFrames;
    }
    const level = this.hls?.levels?.[this.hls.currentLevel];
    if (level) {
      patch.bitrateKbps = Math.round(level.bitrate / 1000);
      patch.videoCodec = level.videoCodec;
      patch.audioCodec = level.audioCodec;
    }
    this.store.patch({ stats: { ...this.store.get().stats, ...patch } });
  }

  private syncTime() {
    const v = this.video;
    const seekable = v.seekable;
    const hasRange = seekable.length > 0;
    const rangeStart = hasRange ? seekable.start(0) : 0;
    const rangeEnd = hasRange ? seekable.end(seekable.length - 1) : v.duration;
    const live = !Number.isFinite(v.duration) || this.hls?.levels?.[this.hls.currentLevel]?.details?.live === true;
    const buffered = v.buffered;
    let bufferedAhead = 0;
    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= v.currentTime && v.currentTime <= buffered.end(i)) {
        bufferedAhead = buffered.end(i) - v.currentTime;
        break;
      }
    }
    this.store.patch({
      position: Math.max(0, v.currentTime - rangeStart),
      duration: live ? rangeEnd - rangeStart : v.duration,
      bufferedAhead,
      live,
    });
  }

  private syncTracks() {
    if (!this.hls) return;
    const h = this.hls;
    const tracks: Track[] = [
      ...h.audioTracks.map((t, i) => ({
        id: String(i),
        kind: "audio" as const,
        title: t.name,
        lang: t.lang,
        codec: t.audioCodec,
        selected: h.audioTrack === i,
      })),
      ...h.subtitleTracks.map((t, i) => ({
        id: String(i),
        kind: "subtitle" as const,
        title: t.name,
        lang: t.lang,
        selected: h.subtitleTrack === i,
      })),
    ];
    this.store.patch({ tracks });
  }

  private destroyHls() {
    this.hls?.destroy();
    this.hls = null;
  }

  async load(source: PlaySource): Promise<void> {
    this.destroyHls();
    this.store.reset();
    this.store.patch({ status: "loading", live: source.live ?? false });
    const v = this.video;

    if (HLS_RE.test(source.url) && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
      });
      this.hls = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.syncTracks();
        void this.tryPlay();
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this.syncTracks());
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => this.syncTracks());
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => this.syncTracks());
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, () => this.syncTracks());
      hls.on(Hls.Events.LEVEL_LOADED, () => this.syncTime());
      hls.on(Hls.Events.LEVEL_SWITCHED, () => this.syncStats());
      hls.on(Hls.Events.ERROR, (_e, data: ErrorData) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else this.store.patch({ status: "error", error: data.details });
      });
      hls.loadSource(source.url);
      hls.attachMedia(v);
      return;
    }

    v.src = source.url;
    v.load();
    await this.tryPlay();
  }

  /**
   * Autoplay-with-sound is blocked by browsers without prior user interaction
   * (`play()` rejects with NotAllowedError). Retry muted so playback actually
   * starts instead of sitting on the browser's own "tap for sound" overlay —
   * the UI can offer an unmute control since `state.muted` reflects this.
   */
  private async tryPlay(): Promise<void> {
    const v = this.video;
    try {
      await v.play();
    } catch (e) {
      if (!v.muted) {
        v.muted = true;
        this.store.patch({ muted: true });
        try {
          await v.play();
          return;
        } catch {
          /* fall through to error below */
        }
      }
      this.store.patch({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  async play() {
    await this.video.play();
  }

  async pause() {
    this.video.pause();
  }

  async stop() {
    this.destroyHls();
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.store.reset();
  }

  async seek(positionSeconds: number) {
    const s = this.video.seekable;
    const base = s.length > 0 ? s.start(0) : 0;
    const end = s.length > 0 ? s.end(s.length - 1) : Number.POSITIVE_INFINITY;
    this.video.currentTime = Math.min(end, Math.max(base, base + positionSeconds));
  }

  async seekBy(deltaSeconds: number) {
    await this.seek(this.store.get().position + deltaSeconds);
  }

  async setVolume(volume: number) {
    this.video.volume = Math.min(1, Math.max(0, volume));
  }

  async setMuted(muted: boolean) {
    this.video.muted = muted;
  }

  async selectTrack(kind: TrackKind, id: string | null) {
    if (!this.hls) return;
    const idx = id === null ? -1 : Number.parseInt(id, 10);
    if (kind === "audio") {
      if (idx >= 0) this.hls.audioTrack = idx;
    } else {
      this.hls.subtitleTrack = idx;
      this.hls.subtitleDisplay = idx >= 0;
    }
  }

  getState(): PlayerState {
    return this.store.get();
  }

  subscribe(listener: StateListener) {
    return this.store.subscribe(listener);
  }

  destroy() {
    this.video.pause();
    this.destroyHls();
    this.video.removeAttribute("src");
    this.video.load();
    this.detach?.();
    if (this.statsTimer != null) window.clearInterval(this.statsTimer);
    this.store.clear();
  }
}
