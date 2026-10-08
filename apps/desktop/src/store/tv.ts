import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  parseM3U,
  buildEpgIndex,
  resolveEpgChannelId,
  stableId,
  type Channel,
  type EpgData,
  type Playlist,
  type Programme,
} from "@kinonyx/epg";
import { isTauri } from "../data/io";
import { fetchText, pickPlaylistFile, readLocalFile, fileNameOf } from "../data/tv-io";
import { fetchEpgNative, parseEpgInWorker, mergeEpg } from "../data/epg-client";
import { epgRefreshIntervalMs, useApp } from "./app";

/**
 * The "Каналы" section — IPTV playlists, categories, channels with a live guide — ported
 * from PortoTV (same parsers, same screens). Navigation goes through the main app store;
 * this one only holds playlist/guide state.
 */

// Catch-up windows run to 7 days (tvg-rec="7"), plus a little slack; ahead of now we only
// ever show "next". A 7-days-both-ways guide is mostly outside this.
const EPG_PAST_MS = 8 * 86_400_000;
const EPG_FUTURE_MS = 2 * 86_400_000;

function loadEpgSource(url: string, maxAgeMs: number): Promise<EpgData> {
  const now = Date.now();
  if (isTauri) return fetchEpgNative(url, now - EPG_PAST_MS, now + EPG_FUTURE_MS, maxAgeMs);
  return fetchText(url, 60_000).then((xml) => parseEpgInWorker(xml));
}

export type PlaylistSource = { kind: "url"; url: string } | { kind: "file"; path: string };

export interface SavedPlaylist {
  id: string;
  name: string;
  source: PlaylistSource;
  addedAt: number;
  lastLoadedAt?: number;
  lastError?: string;
  channelCount?: number;
  /** When this playlist's EPG last finished loading successfully — compared against
   *  the "Обновление программы передач" setting to decide whether re-opening "Каналы"
   *  can reuse the guide already in memory instead of fetching it again. */
  epgLoadedAt?: number;
}

/** Sentinel group id for channels without a group-title. */
export const UNGROUPED = "__none";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

interface TvState {
  playlists: SavedPlaylist[];
  activePlaylistId: string | null;
  playlist: Playlist | null;
  playlistStatus: LoadStatus;
  playlistError?: string;
  epg: EpgData | null;
  epgIndex: Map<string, string> | null;
  epgStatus: LoadStatus;

  /** Remembered focus so "back" lands where you were, not back at the top of the list. */
  lastCategoryFocus: string | null;
  lastChannelFocus: Record<string, string>;
  lastArchiveFocus: Record<string, number>;

  setLastCategoryFocus(focusKey: string): void;
  setLastChannelFocus(group: string, focusKey: string): void;
  setLastArchiveFocus(channelId: string, start: number): void;
  addPlaylistFromUrl(url: string): Promise<void>;
  /** `path` given (a file dropped onto the window) skips the file dialog. */
  addPlaylistFromFile(path?: string): Promise<void>;
  removePlaylist(id: string): void;
  /** Parses/loads a saved playlist's channels (+ kicks off its EPG fetch in the
   *  background) without navigating anywhere — the piece `openPlaylist` and
   *  `ensurePlaylistLoaded` share. Resolves to whether it actually loaded. */
  loadPlaylistData(id: string): Promise<boolean>;
  openPlaylist(id: string): Promise<void>;
  /** Like `loadPlaylistData`, but a no-op if this playlist is already the active,
   *  loaded one — for opening a favourited channel from outside the "Каналы"
   *  section, where navigating to "tv-categories" first would be the wrong UX. */
  ensurePlaylistLoaded(id: string): Promise<boolean>;
  programmesFor(channel: Channel): Programme[] | undefined;
}

async function loadSource(source: PlaylistSource): Promise<string> {
  return source.kind === "url" ? fetchText(source.url) : readLocalFile(source.path);
}

// Channel -> resolved XMLTV id is stable for as long as the current epgIndex is
// (normalizeName involves a few regex passes) — cached so thousands of tiles don't redo it
// on every 30 s "now playing" refresh. Reset whenever a new epgIndex is set.
let epgIdCache = new WeakMap<Channel, string | undefined>();

export const useTv = create<TvState>()(
  persist(
    (set, get) => ({
      playlists: [],
      activePlaylistId: null,
      playlist: null,
      playlistStatus: "idle",
      epg: null,
      epgIndex: null,
      epgStatus: "idle",
      lastCategoryFocus: null,
      lastChannelFocus: {},
      lastArchiveFocus: {},

      setLastCategoryFocus(focusKey) {
        set({ lastCategoryFocus: focusKey });
      },

      setLastChannelFocus(group, focusKey) {
        set((s) => ({ lastChannelFocus: { ...s.lastChannelFocus, [group]: focusKey } }));
      },

      setLastArchiveFocus(channelId, start) {
        set((s) => ({ lastArchiveFocus: { ...s.lastArchiveFocus, [channelId]: start } }));
      },

      async addPlaylistFromUrl(url) {
        const trimmed = url.trim();
        if (!trimmed) return;
        const entry: SavedPlaylist = {
          id: stableId("url", trimmed),
          name: safeNameFromUrl(trimmed),
          source: { kind: "url", url: trimmed },
          addedAt: Date.now(),
        };
        set((s) => ({ playlists: upsert(s.playlists, entry) }));
        await get().openPlaylist(entry.id);
      },

      async addPlaylistFromFile(path) {
        const picked = path ? { path } : await pickPlaylistFile();
        if (!picked) return;
        const entry: SavedPlaylist = {
          id: stableId("file", picked.path),
          name: fileNameOf(picked.path).replace(/\.(m3u8?|txt)$/i, ""),
          source: { kind: "file", path: picked.path },
          addedAt: Date.now(),
        };
        set((s) => ({ playlists: upsert(s.playlists, entry) }));
        await get().openPlaylist(entry.id);
      },

      removePlaylist(id) {
        set((s) => {
          if (s.activePlaylistId !== id) return { playlists: s.playlists.filter((p) => p.id !== id) };
          epgIdCache = new WeakMap();
          return {
            playlists: s.playlists.filter((p) => p.id !== id),
            activePlaylistId: null,
            playlist: null,
            epg: null,
            epgIndex: null,
          };
        });
      },

      async loadPlaylistData(id) {
        const entry = get().playlists.find((p) => p.id === id);
        if (!entry) return false;

        // Reuse the guide already sitting in memory when it's for this same playlist and
        // still fresh enough per the "Обновление программы передач" setting — re-entering
        // "Каналы" used to unconditionally null out `epg` and refetch it (a real network
        // fetch + XML parse) every single time, which is the "подгружается каждый раз"
        // the guide reload was reported as. This only ever short-circuits within the same
        // running session, though — `epg`/`epgIndex` themselves aren't persisted, so right
        // after an app restart `epgFreshInMemory` is always false here even when
        // `epgLoadedAt` is well within the interval. The actual cross-restart case is
        // handled below by passing `intervalMs` into `loadEpgSource`, which lets the Rust
        // side (src-tauri/src/epg.rs) serve its on-disk cache instead of a real refetch.
        const wasActive = get().activePlaylistId === id;
        const intervalMs = epgRefreshIntervalMs(useApp.getState().epgRefreshInterval);
        const epgFreshInMemory =
          wasActive && get().epg != null && intervalMs > 0 && entry.epgLoadedAt != null && Date.now() - entry.epgLoadedAt < intervalMs;
        const keptEpg = epgFreshInMemory ? get().epg : null;
        const keptEpgIndex = epgFreshInMemory ? get().epgIndex : null;
        const keptEpgStatus = epgFreshInMemory ? get().epgStatus : "idle";

        if (!epgFreshInMemory) epgIdCache = new WeakMap();
        set({
          activePlaylistId: id,
          playlistStatus: "loading",
          playlistError: undefined,
          epg: keptEpg,
          epgIndex: keptEpgIndex,
          epgStatus: keptEpgStatus,
        });
        let playlist: Playlist;
        try {
          playlist = parseM3U(await loadSource(entry.source));
          if (playlist.channels.length === 0) throw new Error("В плейлисте нет каналов");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          set((s) => ({
            playlistStatus: "error",
            playlistError: message,
            playlists: s.playlists.map((p) => (p.id === id ? { ...p, lastError: message } : p)),
          }));
          return false;
        }
        set((s) => ({
          playlist,
          playlistStatus: "ready",
          playlists: s.playlists.map((p) =>
            p.id === id ? { ...p, lastLoadedAt: Date.now(), lastError: undefined, channelCount: playlist.channels.length } : p,
          ),
        }));

        if (playlist.epgUrls.length > 0 && !epgFreshInMemory) {
          // Not awaited — the guide fills in after the channel list is already usable,
          // same as before this was split out of `openPlaylist`.
          void (async () => {
            set({ epgStatus: "loading" });
            // Several url-tvg sources load concurrently, and one bad/slow source (a 404,
            // a timeout) doesn't throw away guide data that did load from the others.
            const results = await Promise.allSettled(playlist.epgUrls.map((url) => loadEpgSource(url, intervalMs)));
            if (get().activePlaylistId !== id) return;
            let merged: EpgData | null = null;
            for (const r of results) {
              if (r.status === "fulfilled") merged = merged ? mergeEpg(merged, r.value) : r.value;
            }
            set({ epg: merged, epgIndex: merged ? buildEpgIndex(merged) : null, epgStatus: merged ? "ready" : "error" });
            if (merged) {
              set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, epgLoadedAt: Date.now() } : p)) }));
            }
          })();
        }
        return true;
      },

      async openPlaylist(id) {
        const ok = await get().loadPlaylistData(id);
        if (ok) useApp.getState().navigate({ name: "tv-categories" });
      },

      async ensurePlaylistLoaded(id) {
        if (get().activePlaylistId === id && get().playlist) return true;
        return get().loadPlaylistData(id);
      },

      programmesFor(channel) {
        const { epg, epgIndex } = get();
        if (!epg || !epgIndex) return undefined;
        let id = epgIdCache.get(channel);
        if (id === undefined && !epgIdCache.has(channel)) {
          id = resolveEpgChannelId(channel, epg, epgIndex);
          epgIdCache.set(channel, id);
        }
        return id ? epg.programmes.get(id) : undefined;
      },
    }),
    {
      name: "kinonyx.tv",
      partialize: (s) => ({ playlists: s.playlists, activePlaylistId: s.activePlaylistId }),
    },
  ),
);

function upsert(list: SavedPlaylist[], entry: SavedPlaylist) {
  const i = list.findIndex((p) => p.id === entry.id);
  if (i < 0) return [...list, entry];
  const next = list.slice();
  next[i] = { ...next[i], ...entry, addedAt: next[i].addedAt };
  return next;
}

function safeNameFromUrl(url: string) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last ? `${u.hostname} / ${decodeURIComponent(last)}` : u.hostname;
  } catch {
    return url;
  }
}
