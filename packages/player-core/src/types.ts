export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "buffering" | "ended" | "error";

export interface PlaySource {
  url: string;
  /** Optional HTTP headers; only honored by adapters that control the network layer (mpv). */
  headers?: Record<string, string>;
  userAgent?: string;
  /** Hint for UI: finite file vs. an endless stream. Torrserve/torrent sources are always false. */
  live?: boolean;
  title?: string;
  /** Per-file mpv options (applied for this title only, e.g. a deliberate start delay). */
  mpvOptions?: Record<string, string>;
}

export type TrackKind = "audio" | "subtitle";

export interface Track {
  id: string;
  kind: TrackKind;
  title?: string;
  lang?: string;
  codec?: string;
  selected: boolean;
}

export interface PlayerStats {
  width?: number;
  height?: number;
  /** Measured, from actually-presented frames — not just the stream's advertised rate. */
  fps?: number;
  bitrateKbps?: number;
  videoCodec?: string;
  audioCodec?: string;
  droppedFrames?: number;
}

export interface PlayerState {
  status: PlayerStatus;
  /** Seconds from start of the playable range. */
  position: number;
  /** Seconds; NaN or Infinity for endless live streams. */
  duration: number;
  /** Seconds of buffered media ahead of `position`. */
  bufferedAhead: number;
  volume: number;
  muted: boolean;
  live: boolean;
  tracks: Track[];
  stats: PlayerStats;
  error?: string;
}

export const INITIAL_STATE: PlayerState = {
  status: "idle",
  position: 0,
  duration: Number.NaN,
  bufferedAhead: 0,
  volume: 1,
  muted: false,
  live: false,
  tracks: [],
  stats: {},
};

export type StateListener = (state: PlayerState) => void;

/** Platform-agnostic player contract. Every backend (mpv, HTML5/hls.js, …) implements this. */
export interface PlayerAdapter {
  readonly name: string;
  load(source: PlaySource): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(positionSeconds: number): Promise<void>;
  seekBy(deltaSeconds: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  selectTrack(kind: TrackKind, id: string | null): Promise<void>;
  /** Voice-over ducking: scales the original audio (1 = as is) without touching `volume`.
   *  Needs the source to carry the `@kxduck` audio filter (see mpv-adapter). */
  setDuck?(gain: number): Promise<void>;
  /** Shrinks the picture into part of the surface (mini window): each value is the share of the
   *  surface left empty on that side (0..1). `null` = the whole surface. mpv only. */
  setVideoMargins?(margins: { left: number; right: number; top: number; bottom: number } | null): Promise<void>;
  /** Raw mpv property access (mpv only): reads a string property / sets one live. */
  getProp?(key: string): Promise<string | undefined>;
  setProp?(key: string, value: string): Promise<void>;
  getState(): PlayerState;
  subscribe(listener: StateListener): () => void;
  destroy(): void;
}
