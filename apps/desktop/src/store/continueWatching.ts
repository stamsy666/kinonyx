import { create } from "zustand";
import type { MetadataSource } from "../data/api";
import { useApp } from "./app";

const KEY = "kinonyx.continueWatching";
/** Below this, "resume" isn't meaningfully different from "start over". */
const MIN_POSITION = 20;
/** Above this fraction, treat the film as finished — drop it instead of showing "1% left". */
const FINISHED_FRACTION = 0.95;

export interface ContinueWatchingEntry {
  filmId: number;
  title: string;
  poster?: string;
  position: number;
  duration: number;
  updatedAt: number;
  /** Name + year of the film, so the entry can be re-matched after a source switch. */
  film?: { nameRu?: string; nameOriginal?: string; year?: string | number; genres?: string[] };
  /** Source the `filmId` belongs to; missing on old entries = Kinopoisk. */
  source?: MetadataSource;
}

function read(): ContinueWatchingEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as ContinueWatchingEntry[];
  } catch {
    /* falls through to empty */
  }
  return [];
}

function write(items: ContinueWatchingEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* progress just won't survive a restart */
  }
}

interface ContinueWatchingState {
  items: ContinueWatchingEntry[];
  /** Called (throttled) from the player while a tracked film/episode plays. Drops the
   *  entry once it's essentially finished or barely started — no "0:03 watched" clutter,
   *  no "congratulations, you finished it, now finish it again" leftover card. */
  report: (entry: Omit<ContinueWatchingEntry, "updatedAt">) => void;
  remove: (filmId: number) => void;
  positionFor: (filmId: number) => number | undefined;
  remap: (oldId: number, newId: number, source: MetadataSource) => void;
}

export const useContinueWatching = create<ContinueWatchingState>((set, get) => ({
  items: read(),
  report: ({ filmId, title, poster, position, duration, film }) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const fraction = position / duration;
    const { items } = get();
    const withoutThis = items.filter((e) => e.filmId !== filmId);
    if (position < MIN_POSITION || fraction >= FINISHED_FRACTION) {
      if (withoutThis.length === items.length) return;
      set({ items: withoutThis });
      write(withoutThis);
      return;
    }
    const source = useApp.getState().metadataSource ?? "kinopoisk";
    const next = [{ filmId, title, poster, position, duration, film, source, updatedAt: Date.now() }, ...withoutThis];
    set({ items: next });
    write(next);
  },
  remove: (filmId) => {
    const next = get().items.filter((e) => e.filmId !== filmId);
    set({ items: next });
    write(next);
  },
  positionFor: (filmId) => get().items.find((e) => e.filmId === filmId)?.position,
  remap: (oldId, newId, source) => {
    const next = get()
      .items.map((e) => (e.filmId === oldId ? { ...e, filmId: newId, source } : e))
      .filter((e, i, all) => all.findIndex((g) => g.filmId === e.filmId) === i);
    set({ items: next });
    write(next);
  },
}));
