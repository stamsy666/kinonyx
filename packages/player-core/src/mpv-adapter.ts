import {
  init as mpvInit,
  command as mpvCommand,
  setProperty as mpvSetProperty,
  getProperty as mpvGetProperty,
  listenEvents,
  observeProperties,
  type MpvObservableProperty,
} from "tauri-plugin-libmpv-api";
import { invoke } from "@tauri-apps/api/core";
import { StateStore } from "./state-store";
import type { ExtraTrack, FrameGeneration, PlaySource, PlayerAdapter, PlayerState, StateListener, Track, TrackKind } from "./types";

const OBSERVED_PROPERTIES = [
  ["pause", "flag"],
  ["core-idle", "flag"],
  ["paused-for-cache", "flag"],
  ["eof-reached", "flag"],
  ["time-pos", "double", "none"],
  ["duration", "double", "none"],
  ["demuxer-cache-time", "double", "none"],
  ["volume", "double"],
  ["mute", "flag"],
  ["track-list", "node"],
  ["chapter-list", "node"],
  ["width", "int64", "none"],
  ["height", "int64", "none"],
  ["video-codec", "string", "none"],
  ["audio-codec", "string", "none"],
  ["estimated-vf-fps", "double", "none"],
  ["video-bitrate", "double", "none"],
  ["audio-bitrate", "double", "none"],
  ["frame-drop-count", "int64", "none"],
] as const satisfies MpvObservableProperty[];

interface MpvTrack {
  id: number;
  type: "audio" | "sub" | "video";
  title?: string;
  lang?: string;
  codec?: string;
  selected?: boolean;
}

// Some providers/releases tag tracks with placeholder metadata instead of omitting the
// field — seen in the wild as a literal "???" title/lang on an otherwise-blank track.
// Treat those the same as genuinely missing, so the UI's own "Дорожка N" fallback kicks
// in instead of showing the placeholder verbatim. (Ported as-is from PortoTV, where this
// was confirmed against real IPTV provider metadata — torrent releases can carry the same
// kind of junk in their embedded track names.)
const PLACEHOLDER_TRACK_TEXT = new Set(["???", "und", "unk", "unknown", ""]);
function cleanTrackText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || PLACEHOLDER_TRACK_TEXT.has(trimmed.toLowerCase())) return undefined;
  // An external audio/subtitle file (a trailer's separate YouTube audio stream) is named by
  // mpv after its URL — or the query-string tail of it — not a human title.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /[?&][\w-]+=/.test(trimmed)) return undefined;
  return trimmed;
}

// The plugin keeps exactly one mpv instance per window, keyed by window label, and its
// `init` silently no-ops when one already exists. One instance for the app's lifetime —
// loadfile/stop per title — is both how mpv is meant to be driven and immune to the
// create/destroy race this caused when tried per-screen (see PortoTV's CLAUDE.md journal
// for the original incident this comment refers to).
let mpvReady: Promise<void> | null = null;

export function prepareMpv(): Promise<void> {
  if (!mpvReady) {
    mpvReady = mpvInit({
      initialOptions: {
        vo: "gpu-next",
        hwdec: "auto-safe",
        "keep-open": "yes",
        "force-window": "yes",
        // Torrent streams arrive in bursts as pieces complete, so the player's own buffer
        // is what smooths them out. Defaults (≈150 MiB, resume after just 1 s of data)
        // produced the "constant buffering" pattern whenever download speed hovered near
        // the bitrate: stall → 1 s → stall again. A deep buffer plus waiting for 5 s of
        // data before (re)starting trades one short wait for continuous playback.
        cache: "yes",
        "demuxer-max-bytes": "512MiB",
        "demuxer-max-back-bytes": "64MiB",
        "cache-pause-initial": "yes",
        "cache-pause-wait": "5",
        "network-timeout": "60",
      },
      observedProperties: OBSERVED_PROPERTIES,
    })
      .then(() => undefined)
      .catch((e: unknown) => {
        mpvReady = null;
        throw e;
      });
  }
  return mpvReady;
}

/** A per-title option mpv doesn't know (an older build, another video output) must not stop
 *  the video from loading — it just isn't applied. */
async function softSet(key: string, value: string) {
  try {
    await mpvSetProperty(key, value);
  } catch (e) {
    console.warn(`[mpv] option ${key}=${value} not applied:`, e);
  }
}

/** Defaults restored for `PlaySource.mpvOptions` keys once a title no longer asks for them.
 *  (cache-pause-* need no entry: every load sets them anyway.) */
const OPTION_DEFAULTS: Record<string, string> = {
  "rebase-start-time": "yes",
  af: "",
  vf: "",
  hwdec: "auto-safe",
  alang: "",
  "audio-files": "",
  "demuxer-lavf-format": "",
  "hls-bitrate": "max",
  start: "none",
  "sub-scale": "1",
  "sub-color": "#FFFFFF",
  scale: "bilinear",
  cscale: "bilinear",
  deband: "no",
  "video-sync": "audio",
  interpolation: "no",
  tscale: "mitchell",
  "tone-mapping": "auto",
  "hdr-compute-peak": "auto",
  "target-colorspace-hint": "no",
  "video-aspect-override": "-1",
  keepaspect: "yes",
  panscan: "0",
};

/** Audio filter a source adds (via `mpvOptions.af`) to make `setDuck` work. */
export const DUCK_FILTER = "@kxduck:lavfi=[volume=volume=1.0]";
let appliedExtraOptions: string[] = [];

// `stop` from the outgoing adapter and `loadfile` from the incoming one are separate IPC
// calls that Tauri may run in either order; chaining them guarantees stop → load.
let commandQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = commandQueue.then(fn, fn);
  commandQueue = run.catch(() => undefined);
  return run;
}

type ResolveAudioDevice = () => Promise<string>;
let appliedAudioDevice: string | undefined;

function frameGenerationFilter(factor: FrameGeneration): Promise<string> {
  return factor ? invoke<string>("frame_generation_filter", { multiplier: factor }) : Promise.resolve("");
}

/** Called inside the mpv command queue so a change cannot race loadfile. */
async function applyAudioDevice(resolve: ResolveAudioDevice): Promise<void> {
  const device = await resolve().catch(() => "auto");
  if (device === appliedAudioDevice) return;
  try {
    await mpvSetProperty("audio-device", device);
    appliedAudioDevice = device;
  } catch (error) {
    appliedAudioDevice = undefined;
    console.warn("[mpv] Audio device could not be applied:", error);
    if (device !== "auto") await softSet("audio-device", "auto");
  }
}

/** Changes the output of the shared player without seeking or reopening its source. */
export function refreshMpvAudioDevice(resolve: ResolveAudioDevice): Promise<void> {
  const ready = mpvReady;
  if (!ready) return Promise.resolve();
  return ready.then(() => enqueue(() => applyAudioDevice(resolve)));
}

/**
 * Desktop adapter: real mpv via tauri-plugin-libmpv, embedded as a native
 * child window behind a transparent slice of the webview (see
 * `.player__video-hole` in theme.css). `source.url` is expected to be a
 * Torrserve HTTP stream URL (http://127.0.0.1:8090/stream/...) rather than a
 * live IPTV URL, but nothing here is torrent-specific — mpv just plays
 * whatever URL it's given.
 */
export class MpvAdapter implements PlayerAdapter {
  readonly name = "mpv";
  private store = new StateStore();
  private unlisten: (() => void) | null = null;
  private unlistenEvents: (() => void) | null = null;
  private attached: Promise<void> | null = null;
  private destroyed = false;
  private loadedUrl: string | null = null;
  private videoFilters = "";
  private hardwareDecoder = OPTION_DEFAULTS.hwdec;

  private paused = true;
  private coreIdle = true;
  private pausedForCache = false;
  private eofReached = false;
  private loading = true;

  constructor(
    private readonly resolveAudioDevice: ResolveAudioDevice = async () => "auto",
    private readonly readFrameGeneration: () => FrameGeneration = () => 0,
  ) {}

  private attach(): Promise<void> {
    if (!this.attached) this.attached = this.subscribe_();
    return this.attached;
  }

  private async subscribe_(): Promise<void> {
    const unlisten = await observeProperties(OBSERVED_PROPERTIES, (event) => {
      if (!this.destroyed) this.onProperty(event.name, event.data);
    });
    if (this.destroyed) {
      unlisten();
      return;
    }
    this.unlisten = unlisten;
    const unlistenEvents = await listenEvents((event) => {
      if (this.destroyed) return;
      if (event.event === "end-file" && event.reason === "error") {
        this.store.patch({ status: "error", error: `mpv: ошибка воспроизведения (код ${event.error})` });
      } else if (event.event === "log-message" && (event.level === "error" || event.level === "fatal")) {
        console.warn(`[mpv ${event.prefix}] ${event.text.trim()}`);
      }
    });
    if (this.destroyed) {
      unlistenEvents();
      return;
    }
    this.unlistenEvents = unlistenEvents;
  }

  /**
   * mpv only reports a property when it changes. With a shared instance the new adapter
   * would otherwise never hear about a `pause` that was already false, and sit on the
   * constructor defaults — read the current values explicitly instead of waiting.
   */
  private async primeState(): Promise<void> {
    // Scalar formats only — NEVER getProperty(..., "node") through this plugin (known
    // STATUS_ACCESS_VIOLATION in the wrapper DLL, see PortoTV's CLAUDE.md journal).
    // track-list is safe on the observe/event path, which fires on every loadfile anyway.
    const [pause, coreIdle, pausedForCache, eofReached, volume, mute] = await Promise.all([
      mpvGetProperty<boolean>("pause", "flag").catch(() => undefined),
      mpvGetProperty<boolean>("core-idle", "flag").catch(() => undefined),
      mpvGetProperty<boolean>("paused-for-cache", "flag").catch(() => undefined),
      mpvGetProperty<boolean>("eof-reached", "flag").catch(() => undefined),
      mpvGetProperty<number>("volume", "double").catch(() => undefined),
      mpvGetProperty<boolean>("mute", "flag").catch(() => undefined),
    ]);
    if (this.destroyed) return;
    if (pause != null) this.paused = pause;
    if (coreIdle != null) this.coreIdle = coreIdle;
    if (pausedForCache != null) this.pausedForCache = pausedForCache;
    if (eofReached != null) this.eofReached = eofReached;
    if (volume != null) this.onProperty("volume", volume);
    if (mute != null) this.onProperty("mute", mute);
    this.syncStats();
  }

  private onProperty(name: string, data: unknown) {
    switch (name) {
      case "pause":
        this.paused = data as boolean;
        this.syncStatus();
        break;
      case "core-idle":
        this.coreIdle = data as boolean;
        this.syncStatus();
        break;
      case "paused-for-cache":
        this.pausedForCache = data as boolean;
        this.syncStatus();
        break;
      case "eof-reached":
        this.eofReached = data as boolean;
        this.syncStatus();
        break;
      case "time-pos":
        this.store.patch({ position: (data as number | null) ?? 0 });
        break;
      case "duration":
        this.store.patch({ duration: (data as number | null) ?? Number.NaN });
        break;
      case "demuxer-cache-time": {
        const pos = this.store.get().position;
        const cacheEnd = data as number | null;
        this.store.patch({ bufferedAhead: cacheEnd != null ? Math.max(0, cacheEnd - pos) : 0 });
        break;
      }
      case "volume":
        this.store.patch({ volume: Math.min(1, Math.max(0, ((data as number | null) ?? 100) / 100)) });
        break;
      case "mute":
        this.store.patch({ muted: (data as boolean | null) ?? false });
        break;
      case "track-list":
        this.syncTracks(data as MpvTrack[] | null);
        break;
      case "chapter-list": {
        const list = (data as { title?: string; time?: number }[] | null) ?? [];
        this.store.patch({ chapters: list.map((c) => ({ title: c.title ?? "", start: c.time ?? 0 })) });
        break;
      }
      case "width":
      case "height":
      case "video-codec":
      case "audio-codec":
      case "estimated-vf-fps":
      case "video-bitrate":
      case "audio-bitrate":
      case "frame-drop-count":
        this.syncStats();
        break;
    }
  }

  /** Recomputed from the latest flags rather than reacted to one at a time — several of
   * them can change out of order within the same tick, and this stays correct regardless. */
  private syncStatus() {
    if (this.loading) return;
    let status: PlayerState["status"];
    if (this.eofReached) status = "ended";
    else if (this.pausedForCache) status = "buffering";
    else if (this.paused) status = "paused";
    else if (this.coreIdle) status = "buffering";
    else status = "playing";
    this.store.patch({ status });
  }

  private syncTracks(list: MpvTrack[] | null) {
    const tracks: Track[] = (list ?? [])
      .filter((t): t is MpvTrack & { type: "audio" | "sub" } => t.type === "audio" || t.type === "sub")
      .map((t) => ({
        id: String(t.id),
        kind: (t.type === "sub" ? "subtitle" : "audio") as TrackKind,
        title: cleanTrackText(t.title),
        lang: cleanTrackText(t.lang),
        codec: t.codec,
        selected: t.selected ?? false,
      }));
    this.store.patch({ tracks });
  }

  private syncStats() {
    void Promise.all([
      mpvGetProperty<number>("width", "int64").catch(() => undefined),
      mpvGetProperty<number>("height", "int64").catch(() => undefined),
      mpvGetProperty<string>("video-codec", "string").catch(() => undefined),
      mpvGetProperty<string>("audio-codec", "string").catch(() => undefined),
      mpvGetProperty<number>("estimated-vf-fps", "double").catch(() => undefined),
      mpvGetProperty<number>("video-bitrate", "double").catch(() => undefined),
      mpvGetProperty<number>("audio-bitrate", "double").catch(() => undefined),
      mpvGetProperty<number>("frame-drop-count", "int64").catch(() => undefined),
    ]).then(([width, height, videoCodec, audioCodec, fps, videoBitrate, audioBitrate, droppedFrames]) => {
      const bitrateBps = (videoBitrate ?? 0) + (audioBitrate ?? 0);
      this.store.patch({
        stats: {
          width: width || undefined,
          height: height || undefined,
          videoCodec: videoCodec || undefined,
          audioCodec: audioCodec || undefined,
          fps: fps ? Math.round(fps) : undefined,
          bitrateKbps: bitrateBps ? Math.round(bitrateBps / 1000) : undefined,
          droppedFrames,
        },
      });
    });
  }

  async load(source: PlaySource): Promise<void> {
    const serial = ++this.loadSerial;
    this.loading = true;
    this.store.reset();
    this.store.patch({ status: "loading", live: source.live ?? false });
    try {
      await prepareMpv();
      await this.attach();
      if (this.destroyed) return;
      await enqueue(async () => {
        if (this.destroyed) return;
        await applyAudioDevice(this.resolveAudioDevice);
        if (this.destroyed) return;
        await mpvSetProperty(
          "http-header-fields",
          source.headers ? Object.entries(source.headers).map(([k, v]) => `${k}: ${v}`).join(",") : "",
        );
        await mpvSetProperty("user-agent", source.userAgent ?? "");
        // Deep pre-buffering suits torrent files; a live channel should start at once,
        // and switching channels shouldn't cost a 5 s wait each time.
        await mpvSetProperty("cache-pause-initial", !source.live);
        await mpvSetProperty("cache-pause-wait", source.live ? 1 : 5);
        // Extra options are set as plain properties (the loadfile per-file option list
        // didn't reliably take effect through the plugin — `rebase-start-time` was ignored),
        // and anything a previous title changed goes back to its default.
        const extra = { ...source.mpvOptions };
        if (source.startPosition != null) extra.start = String(source.startPosition);
        this.videoFilters = extra.vf ?? "";
        this.hardwareDecoder = extra.hwdec ?? OPTION_DEFAULTS.hwdec;
        const factor = source.frameGeneration ?? this.readFrameGeneration();
        const filter = factor ? await frameGenerationFilter(factor).catch(() => "") : "";
        if (this.destroyed) return;
        if (filter) {
          extra.hwdec = "auto-copy";
          extra.vf = [this.videoFilters, filter].filter(Boolean).join(",");
        }
        // A new player session should use its language preference even if the
        // shared mpv instance was last set to a specific track.
        if (this.loadedUrl === null && extra.alang) await softSet("aid", "auto");
        for (const key of appliedExtraOptions) {
          if (!(key in extra) && key in OPTION_DEFAULTS) await softSet(key, OPTION_DEFAULTS[key]);
        }
        for (const [key, value] of Object.entries(extra)) await softSet(key, value);
        appliedExtraOptions = Object.keys(extra);
        await mpvCommand("loadfile", [source.url, "replace"]);
        if (this.loadedUrl !== source.url) {
          await mpvSetProperty("pause", false);
          this.loadedUrl = source.url;
        }
      });
      if (this.destroyed) return;
      this.loading = false;
      await this.primeState();
      this.syncStatus();
      if (source.extraTracks?.length) void this.addExtraTracks(source.extraTracks, serial);
    } catch (e) {
      if (this.destroyed) return;
      this.loading = false;
      this.store.patch({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  private loadSerial = 0;

  /**
   * Subtitles and sound tracks from beside the file: added with `sub-add` / `audio-add` (which give them a name and a language
   * for the menu) once mpv has the file open — it says "no file" until then, so each is tried again every half second for a while.
   * A newer load makes the older one stop.
   */
  private async addExtraTracks(tracks: ExtraTrack[], serial: number): Promise<void> {
    for (const t of tracks) {
      for (let attempt = 0; attempt < 40; attempt++) {
        if (this.destroyed || serial !== this.loadSerial) return;
        try {
          await enqueue(async () => {
            if (this.destroyed || serial !== this.loadSerial) return;
            await mpvCommand(t.kind === "subtitle" ? "sub-add" : "audio-add", [t.url, "auto", t.title ?? "", t.lang ?? ""]);
          });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }
  }

  /** Fire-and-forget controls: a failure (e.g. a command racing a title switch) is
   *  worth a console line, not an unhandled rejection that takes nothing down but noise. */
  private async control(fn: () => Promise<void>): Promise<void> {
    if (this.destroyed) return;
    try {
      await fn();
    } catch (e) {
      console.warn("[mpv]", e instanceof Error ? e.message : e);
    }
  }

  play() {
    return this.control(() => mpvSetProperty("pause", false));
  }

  pause() {
    return this.control(() => mpvSetProperty("pause", true));
  }

  async stop() {
    ++this.loadSerial;
    await this.control(() => enqueue(async () => {
      this.loadedUrl = null;
      await mpvCommand("stop");
    }));
    this.store.reset();
  }

  seek(positionSeconds: number, exact = false) {
    return this.control(() => mpvCommand("seek", [positionSeconds, exact ? "absolute+exact" : "absolute"]));
  }

  seekBy(deltaSeconds: number, exact = false) {
    return this.control(() => mpvCommand("seek", [deltaSeconds, exact ? "relative+exact" : "relative"]));
  }

  setVolume(volume: number) {
    return this.control(() => mpvSetProperty("volume", Math.min(1, Math.max(0, volume)) * 100));
  }

  setMuted(muted: boolean) {
    return this.control(() => mpvSetProperty("mute", muted));
  }

  selectTrack(kind: TrackKind, id: string | null) {
    // aid/sid are mpv "choice" properties (a track id OR the keywords no/auto) — the string
    // form is required, a native number fails with "error accessing property".
    return this.control(() => mpvSetProperty(kind === "audio" ? "aid" : "sid", id ?? "no"));
  }

  setDuck(gain: number) {
    // The last argument names the filter inside the lavfi graph; without it mpv answers
    // "error running command".
    return this.control(() => mpvCommand("af-command", ["kxduck", "volume", gain.toFixed(3), "volume"]));
  }

  getProp(key: string) {
    return mpvGetProperty<string>(key, "string").catch(() => undefined);
  }

  setProp(key: string, value: string) {
    return this.control(() => softSet(key, value));
  }

  setFrameGeneration(factor: FrameGeneration): Promise<void> {
    return enqueue(async () => {
      if (this.destroyed || !this.loadedUrl) return;
      const filter = await frameGenerationFilter(factor);
      if (this.destroyed) return;
      try {
        if (filter) await mpvSetProperty("hwdec", "auto-copy");
        await mpvSetProperty("vf", [this.videoFilters, filter].filter(Boolean).join(","));
        if (!filter) await mpvSetProperty("hwdec", this.hardwareDecoder);
      } catch (error) {
        await softSet("vf", this.videoFilters);
        await softSet("hwdec", this.hardwareDecoder);
        throw error;
      }
      for (const option of ["hwdec", "vf"]) {
        if (!appliedExtraOptions.includes(option)) appliedExtraOptions.push(option);
      }
    });
  }

  setVideoMargins(margins: { left: number; right: number; top: number; bottom: number } | null) {
    const m = margins ?? { left: 0, right: 0, top: 0, bottom: 0 };
    return this.control(async () => {
      await mpvSetProperty("video-margin-ratio-left", m.left);
      await mpvSetProperty("video-margin-ratio-right", m.right);
      await mpvSetProperty("video-margin-ratio-top", m.top);
      await mpvSetProperty("video-margin-ratio-bottom", m.bottom);
    });
  }

  getState(): PlayerState {
    return this.store.get();
  }

  subscribe(listener: StateListener) {
    return this.store.subscribe(listener);
  }

  destroy() {
    this.destroyed = true;
    this.unlisten?.();
    this.unlistenEvents?.();
    this.store.clear();
    if (mpvReady) void enqueue(() => mpvCommand("stop")).catch(() => undefined);
  }
}
