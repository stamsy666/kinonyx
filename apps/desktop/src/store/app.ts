import { create } from "zustand";
import { isFullscreen, setFullscreen } from "../data/fullscreen";
import {
  focusBackFromSidebar,
  rememberFocusBeforeSidebar,
  resetScroll,
  restoreSnapshot,
  takeSnapshot,
  type FocusSnapshot,
} from "../data/focusRestore";
import type {
  KpCollectionItem,
  KpFilter,
  KpStaffPerson,
  MetadataSource,
  TorrentFile,
  TrailerQuality,
} from "../data/api";
import type { CatalogKind } from "../data/catalogs";
import type { Programme } from "@kinonyx/epg";
import { applyBgPalette, BG_KINDS, type BgKind } from "../data/backgrounds";
import type { SoundCategory } from "../data/sounds";
import type { MusicTrack } from "../data/music";

export type Screen =
  | { name: "home" }
  | { name: "catalog"; kind: CatalogKind }
  | { name: "categories-hub" }
  | { name: "genre"; kind: CatalogKind; title: string; filter: KpFilter }
  /** `preview` is the card the film was opened from — it already has title, poster,
   *  rating, genres and description, so the page renders at once instead of waiting
   *  on the API (and often doesn't need the details request at all). */
  | { name: "movie"; id: number; preview?: KpCollectionItem }
  | { name: "person"; id: number; preview?: KpStaffPerson }
  | { name: "gallery"; filmId: number; startIndex: number }
  /** `hash` — the torrent behind `url`, for live swarm stats in the player. */
  | {
      name: "player";
      title: string;
      url: string;
      /** Selectable qualities (YouTube trailers) — `url` is the one at `qualityIndex`. */
      qualities?: TrailerQuality[];
      qualityIndex?: number;
      hash?: string;
      /** Set only for a genuine movie/episode watch (never a trailer) — enables
       *  "continue watching" progress tracking, keyed by the film's own id. */
      filmId?: number;
      poster?: string;
      /** Name + year of the film being watched — saved with its progress for re-matching. */
      film?: { nameRu?: string; nameOriginal?: string; year?: string | number; genres?: string[] };
      /** The other playable files from the same torrent (a season pack) — lets the OSD
       *  offer "next episode" without reopening the release picker. */
      episodes?: { hash: string; files: TorrentFile[]; index: number };
    }
  /** Trailers Kinopoisk only offers as its own embeddable widget (not a YouTube link
   *  yt-dlp can resolve) — shown full-screen in an iframe instead of the mpv player. */
  | { name: "web-trailer"; title: string; url: string }
  | { name: "search" }
  | { name: "favorites" }
  | { name: "settings" }
  | { name: "setup" }
  | { name: "diagnostics" }
  // TV channels (IPTV), ported from PortoTV: playlists → categories → channels → player.
  | { name: "tv" }
  | { name: "tv-categories" }
  | { name: "tv-channels"; group?: string }
  // `programme`: an aired programme to open at (catch-up) instead of the live stream.
  | { name: "tv-player"; channelId: string; programme?: Programme };

/** The focusKey of a screen's own top-level FocusGroup — used to hand focus back to the
 *  page once the sidebar closes over it without navigating anywhere (backdrop, Back, or
 *  re-picking the section already open). Without this, the sidebar's own focused item
 *  has just unmounted and nothing claims focus in its place — the remote does nothing
 *  at all until the user reaches for the mouse. Each FocusGroup remembers its own last-
 *  focused child by default, so targeting the group resolves to wherever the user was. */
function focusKeyOfScreen(s: Screen): string | undefined {
  switch (s.name) {
    case "home":
      return "home";
    case "catalog":
      return `catalog:${s.kind}`;
    case "categories-hub":
      return "categories-hub";
    case "genre":
      return "genre";
    case "movie":
      return "movie";
    case "person":
      return "person";
    case "gallery":
      return "gallery";
    case "search":
      return "search";
    case "favorites":
      return "favorites";
    case "settings":
      return "settings";
    case "tv":
      return "screen:playlists";
    case "tv-categories":
      return "screen:categories";
    case "tv-channels":
      return "screen:channels";
    default:
      return undefined;
  }
}

/** One frame so the sidebar has actually unmounted (its focused item's removal) before
 *  focus goes back — onto the card that was focused before the sidebar opened, or the
 *  screen's group if that card is gone. */
function restoreFocus(screen: Screen) {
  focusBackFromSidebar(focusKeyOfScreen(screen));
}

/** Where focus/scroll were on each screen in `history`, index for index. Not store state:
 *  nothing renders from it. */
const snapshots: FocusSnapshot[] = [];

const STATS_KEY = "kinonyx.showStreamStats";
const BG_KEY = "kinonyx.background";
const SOUND_KEY = "kinonyx.soundChoice";
const VOLUME_KEY = "kinonyx.sfxVolume";
const MUSIC_ENABLED_KEY = "kinonyx.musicEnabled";
const CLICK_SPARK_KEY = "kinonyx.clickSpark";
const MUSIC_VOLUME_KEY = "kinonyx.musicVolume";
const EPG_REFRESH_KEY = "kinonyx.epgRefreshInterval";
const PLAYER_DIM_KEY = "kinonyx.playerDim";
const PLAYER_PREFS_KEY = "kinonyx.playerPrefs";

/** Player look & behaviour tweaks from Settings. `autoHideSec` 0 = controls never auto-hide. */
export interface PlayerPrefs {
  /** Size of the on-screen controls (buttons, title, time): 0.85 … 1.4. */
  uiScale: number;
  autoHideSec: number;
  /** mpv `sub-scale`. */
  subtitleScale: number;
  /** mpv `sub-color`, "#RRGGBB". */
  subtitleColor: string;
  /** Evens out loud and quiet parts (mpv `dynaudnorm`) — for watching at night. */
  nightMode: boolean;
  /** Video scaling quality (mpv `scale`/`cscale`): sharper costs GPU. */
  upscale: "default" | "sharp" | "max";
  /** Smooths banding in gradients (mpv `deband`). */
  deband: boolean;
  /** HDR → SDR mapping for ordinary screens (mpv `tone-mapping`). */
  toneMapping: "auto" | "soft" | "contrast";
}

export const DEFAULT_PLAYER_PREFS: PlayerPrefs = {
  uiScale: 1,
  autoHideSec: 4,
  subtitleScale: 1,
  subtitleColor: "#FFFFFF",
  nightMode: false,
  upscale: "default",
  deband: false,
  toneMapping: "auto",
};

function readPlayerPrefs(): PlayerPrefs {
  try {
    const raw = localStorage.getItem(PLAYER_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PlayerPrefs>;
      const num = (v: unknown, lo: number, hi: number, d: number) =>
        typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
      return {
        uiScale: num(p.uiScale, 0.7, 1.6, DEFAULT_PLAYER_PREFS.uiScale),
        autoHideSec: num(p.autoHideSec, 0, 60, DEFAULT_PLAYER_PREFS.autoHideSec),
        subtitleScale: num(p.subtitleScale, 0.3, 3, DEFAULT_PLAYER_PREFS.subtitleScale),
        subtitleColor:
          typeof p.subtitleColor === "string" && /^#[0-9a-fA-F]{6}$/.test(p.subtitleColor)
            ? p.subtitleColor
            : DEFAULT_PLAYER_PREFS.subtitleColor,
        nightMode: p.nightMode === true,
        upscale: p.upscale === "sharp" || p.upscale === "max" ? p.upscale : "default",
        deband: p.deband === true,
        toneMapping: p.toneMapping === "soft" || p.toneMapping === "contrast" ? p.toneMapping : "auto",
      };
    }
  } catch {
    /* falls through to defaults */
  }
  return { ...DEFAULT_PLAYER_PREFS };
}

// Matches the `${prefix}:${index}` id scheme data/sounds.ts assigns each file —
// duplicated here (rather than imported) to avoid a load-order dependency between
// the store and the sound engine, which reads the store back at play time.
const DEFAULT_SOUND_CHOICE: Record<SoundCategory, string | null> = {
  buttons: "buttons:0",
  navigation: "navigation:0",
  menuNavigation: "menuNavigation:0",
  typing: "typing:0",
};

function readBool(key: string, fallback = false): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function readBgKind(): BgKind {
  try {
    const v = localStorage.getItem(BG_KEY);
    if (v && (BG_KINDS as string[]).includes(v)) return v as BgKind;
  } catch {
    /* falls through to default */
  }
  // First launch (nothing saved yet): "Графит".
  return "mono";
}

function readSoundChoice(): Record<SoundCategory, string | null> {
  try {
    const raw = localStorage.getItem(SOUND_KEY);
    if (raw)
      return {
        ...DEFAULT_SOUND_CHOICE,
        ...(JSON.parse(raw) as Partial<Record<SoundCategory, string | null>>),
      };
  } catch {
    /* falls through to default */
  }
  return { ...DEFAULT_SOUND_CHOICE };
}

function readVolume(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) return Math.max(0, Math.min(1, Number(raw)));
  } catch {
    /* falls through to default */
  }
  return fallback;
}

/** How often the TV guide (EPG) is allowed to be refetched for an already-loaded
 *  playlist — "always" refetches every time "Каналы" is opened, "day"/"week" reuse
 *  what's already in memory until that much time has passed since the last successful
 *  fetch (see `epgRefreshIntervalMs` and `loadPlaylistData` in store/tv.ts). */
export type EpgRefreshInterval = "always" | "day" | "week";

export function epgRefreshIntervalMs(interval: EpgRefreshInterval): number {
  switch (interval) {
    case "day":
      return 86_400_000;
    case "week":
      return 7 * 86_400_000;
    default:
      return 0;
  }
}

function readEpgRefreshInterval(): EpgRefreshInterval {
  try {
    const v = localStorage.getItem(EPG_REFRESH_KEY);
    if (v === "always" || v === "day" || v === "week") return v;
  } catch {
    /* falls through to default */
  }
  return "day";
}

interface AppState {
  screen: Screen;
  history: Screen[];
  sidebarOpen: boolean;
  fullscreen: boolean;
  showStreamStats: boolean;
  /** Small spark lines radiating from the cursor on a real mouse click (never remote/
   *  keyboard/gamepad — those call a Focusable's `onPress` directly, no click event). */
  clickSparkEnabled: boolean;
  backgroundKind: BgKind;
  soundChoice: Record<SoundCategory, string | null>;
  sfxVolume: number;
  musicEnabled: boolean;
  musicVolume: number;
  /** 0..1 slider for the dimming behind the player OSD; 0.5 is the standard look (CSS multiplier = 2×). */
  playerDim: number;
  setPlayerDim: (v: number) => void;
  playerPrefs: PlayerPrefs;
  setPlayerPrefs: (patch: Partial<PlayerPrefs>) => void;
  /** Show what is being watched as a Discord status (needs Discord running and an application id). */
  discordEnabled: boolean;
  setDiscordEnabled: (on: boolean) => void;
  /** Mirror of the Rust-side metadata source (Settings), so catalog pages can pick the
   *  shelves that suit it. `null` until `configStatus` answers at startup (App.tsx) — the
   *  catalog pages wait for it rather than load Kinopoisk shelves first (500 requests/day). */
  metadataSource: MetadataSource | null;
  setMetadataSourceState: (source: MetadataSource) => void;
  currentTrack: MusicTrack | null;
  epgRefreshInterval: EpgRefreshInterval;
  /** Mouse vs. remote/keyboard/gamepad — decides whether a detail page's back button
   *  floats over the content (mouse has no hardware Back) or sits in the normal flow
   *  (remote/keyboard already have one; see `data/inputMode.ts`). Defaults to "keys",
   *  the project's remote-first default. */
  inputMode: "mouse" | "keys";
  navigate: (screen: Screen) => void;
  /** Swaps the current screen without touching history — for moving between screens of
   *  the same "session" (e.g. switching episodes inside the player) where Back should
   *  still exit to whatever opened that session, not step back through each swap first. */
  replace: (screen: Screen) => void;
  back: () => boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  toggleFullscreen: () => Promise<void>;
  setShowStreamStats: (on: boolean) => void;
  setClickSparkEnabled: (on: boolean) => void;
  setBackgroundKind: (kind: BgKind) => void;
  setSoundChoice: (category: SoundCategory, id: string | null) => void;
  setSfxVolume: (v: number) => void;
  setMusicEnabled: (on: boolean) => void;
  setMusicVolume: (v: number) => void;
  setCurrentTrack: (track: MusicTrack | null) => void;
  setInputMode: (mode: "mouse" | "keys") => void;
  setEpgRefreshInterval: (interval: EpgRefreshInterval) => void;
}

const initialBgKind = readBgKind();
applyBgPalette(initialBgKind);

export const useApp = create<AppState>((set, get) => ({
  screen: { name: "home" },
  history: [],
  sidebarOpen: false,
  fullscreen: false,
  showStreamStats: readBool(STATS_KEY),
  clickSparkEnabled: readBool(CLICK_SPARK_KEY, true),
  backgroundKind: initialBgKind,
  soundChoice: readSoundChoice(),
  sfxVolume: readVolume(VOLUME_KEY, 0.7),
  musicEnabled: readBool(MUSIC_ENABLED_KEY),
  musicVolume: readVolume(MUSIC_VOLUME_KEY, 0.5),
  playerDim: readVolume(PLAYER_DIM_KEY, 0.5),
  discordEnabled: (() => {
    try {
      return localStorage.getItem("kinonyx.discord") !== "0";
    } catch {
      return true;
    }
  })(),
  setDiscordEnabled(on) {
    set({ discordEnabled: on });
    try {
      localStorage.setItem("kinonyx.discord", on ? "1" : "0");
    } catch {
      /* preference just won't survive a restart */
    }
  },
  playerPrefs: readPlayerPrefs(),
  metadataSource: null,
  setMetadataSourceState: (source) => set({ metadataSource: source }),
  currentTrack: null,
  inputMode: "keys",
  epgRefreshInterval: readEpgRefreshInterval(),

  navigate(screen) {
    const { screen: current, history } = get();
    snapshots.length = history.length;
    snapshots.push(takeSnapshot());
    resetScroll();
    set({ screen, history: [...history, current], sidebarOpen: false });
  },

  replace(screen) {
    set({ screen, sidebarOpen: false });
  },

  back() {
    const { screen, history } = get();
    if (get().sidebarOpen) {
      set({ sidebarOpen: false });
      restoreFocus(screen);
      return true;
    }
    if (history.length === 0) return false;
    const next = [...history];
    const newScreen = next.pop()!;
    const snapshot = snapshots.length === history.length ? snapshots.pop() : undefined;
    snapshots.length = next.length;
    set({ screen: newScreen, history: next });
    if (snapshot) restoreSnapshot(snapshot);
    return true;
  },

  openSidebar() {
    rememberFocusBeforeSidebar();
    set({ sidebarOpen: true });
  },
  closeSidebar() {
    const { screen, sidebarOpen } = get();
    set({ sidebarOpen: false });
    if (sidebarOpen) restoreFocus(screen);
  },
  toggleSidebar() {
    const { screen, sidebarOpen } = get();
    if (!sidebarOpen) rememberFocusBeforeSidebar();
    set({ sidebarOpen: !sidebarOpen });
    if (sidebarOpen) restoreFocus(screen);
  },

  async toggleFullscreen() {
    try {
      const next = !(await isFullscreen());
      await setFullscreen(next);
      set({ fullscreen: next });
    } catch (e) {
      console.warn("[fullscreen]", e instanceof Error ? e.message : e);
    }
  },

  setClickSparkEnabled(on) {
    set({ clickSparkEnabled: on });
    try {
      localStorage.setItem(CLICK_SPARK_KEY, on ? "1" : "0");
    } catch {
      /* localStorage unavailable — the choice just won't survive a restart */
    }
  },

  setShowStreamStats(on) {
    set({ showStreamStats: on });
    try {
      localStorage.setItem(STATS_KEY, on ? "1" : "0");
    } catch {
      /* preference just won't survive a restart */
    }
  },

  setBackgroundKind(kind) {
    set({ backgroundKind: kind });
    applyBgPalette(kind);
    try {
      localStorage.setItem(BG_KEY, kind);
    } catch {
      /* preference just won't survive a restart */
    }
  },

  setSoundChoice(category, id) {
    const next = { ...get().soundChoice, [category]: id };
    set({ soundChoice: next });
    try {
      localStorage.setItem(SOUND_KEY, JSON.stringify(next));
    } catch {
      /* preference just won't survive a restart */
    }
  },

  setSfxVolume(v) {
    const clamped = Math.max(0, Math.min(1, v));
    set({ sfxVolume: clamped });
    try {
      localStorage.setItem(VOLUME_KEY, String(clamped));
    } catch {
      /* preference just won't survive a restart */
    }
  },

  setPlayerPrefs(patch) {
    const next = { ...get().playerPrefs, ...patch };
    set({ playerPrefs: next });
    try {
      localStorage.setItem(PLAYER_PREFS_KEY, JSON.stringify(next));
    } catch {
      /* preference just won't survive a restart */
    }
  },

  setPlayerDim(v) {
    const clamped = Math.max(0, Math.min(1, v));
    set({ playerDim: clamped });
    try {
      localStorage.setItem(PLAYER_DIM_KEY, String(clamped));
    } catch {
      /* preference just won't survive a restart */
    }
  },

  setMusicEnabled(on) {
    set({ musicEnabled: on });
    try {
      localStorage.setItem(MUSIC_ENABLED_KEY, on ? "1" : "0");
    } catch {
      /* preference just won't survive a restart */
    }
  },

  setMusicVolume(v) {
    const clamped = Math.max(0, Math.min(1, v));
    set({ musicVolume: clamped });
    try {
      localStorage.setItem(MUSIC_VOLUME_KEY, String(clamped));
    } catch {
      /* preference just won't survive a restart */
    }
  },

  setCurrentTrack(track) {
    set({ currentTrack: track });
  },

  setInputMode(mode) {
    if (get().inputMode !== mode) set({ inputMode: mode });
  },

  setEpgRefreshInterval(interval) {
    set({ epgRefreshInterval: interval });
    try {
      localStorage.setItem(EPG_REFRESH_KEY, interval);
    } catch {
      /* preference just won't survive a restart */
    }
  },
}));
