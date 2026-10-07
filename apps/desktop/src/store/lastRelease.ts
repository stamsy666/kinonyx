import { create } from "zustand";

const KEY = "kinonyx.lastRelease";

/** Enough to redo `openTorrent(link)` + pick the same file again later, without a fresh
 *  title search — `filePath` is the fallback match if TorrServer ever assigns a
 *  different numeric id to the same file on a later add. */
export interface LastRelease {
  link: string;
  fileId: number;
  filePath: string;
  releaseTitle: string;
}

function read(): Record<number, LastRelease> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Record<number, LastRelease>;
  } catch {
    /* falls through to empty */
  }
  return {};
}

function write(items: Record<number, LastRelease>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* choice just won't survive a restart */
  }
}

interface LastReleaseState {
  items: Record<number, LastRelease>;
  set: (filmId: number, release: LastRelease) => void;
  clear: (filmId: number) => void;
  /** Moves a remembered release to the film's id in another source (data/rematch.ts). */
  remap: (oldId: number, newId: number) => void;
}

/** Remembers, per film, the torrent release + file the viewer picked in
 *  `ReleasePickerModal` — so pressing "Смотреть" again (typically from "Продолжить
 *  просмотр") jumps straight to the stream instead of asking them to search and pick
 *  all over again. */
export const useLastRelease = create<LastReleaseState>((set, get) => ({
  items: read(),
  set: (filmId, release) => {
    const next = { ...get().items, [filmId]: release };
    set({ items: next });
    write(next);
  },
  remap: (oldId, newId) => {
    const items = get().items;
    if (oldId === newId || !items[oldId]) return;
    const next = { ...items };
    next[newId] = next[newId] ?? next[oldId];
    delete next[oldId];
    set({ items: next });
    write(next);
  },
  clear: (filmId) => {
    const next = { ...get().items };
    delete next[filmId];
    set({ items: next });
    write(next);
  },
}));
