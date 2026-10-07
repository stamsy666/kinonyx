import { create } from "zustand";
import type { KpCollectionItem } from "../data/api";
import { useApp } from "./app";

const KEY = "kinonyx.favorites";

function readFavorites(): KpCollectionItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as KpCollectionItem[];
  } catch {
    /* falls through to empty */
  }
  return [];
}

function writeFavorites(items: KpCollectionItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* favorites just won't survive a restart */
  }
}

interface FavoritesState {
  items: KpCollectionItem[];
  toggle: (film: KpCollectionItem) => void;
  remove: (id: number) => void;
  /** Swap an entry for its counterpart in another source (see data/rematch.ts). */
  replace: (oldId: number, film: KpCollectionItem) => void;
}

/** Small standalone store (not part of `useApp`) — favorites are persisted data, not
 *  navigation/UI state, same reasoning as `data/music.ts` living apart from the store. */
export const useFavorites = create<FavoritesState>((set, get) => ({
  items: readFavorites(),
  toggle: (film) => {
    const { items } = get();
    const next = items.some((f) => f.kinopoiskId === film.kinopoiskId)
      ? items.filter((f) => f.kinopoiskId !== film.kinopoiskId)
      : [{ ...film, source: film.source ?? useApp.getState().metadataSource ?? "kinopoisk" }, ...items];
    set({ items: next });
    writeFavorites(next);
  },
  remove: (id) => {
    const next = get().items.filter((f) => f.kinopoiskId !== id);
    set({ items: next });
    writeFavorites(next);
  },
  replace: (oldId, film) => {
    const items = get().items;
    // Two favorites can collapse onto one film in the new source — keep a single entry.
    const next = items
      .map((f) => (f.kinopoiskId === oldId ? film : f))
      .filter((f, i, all) => all.findIndex((g) => g.kinopoiskId === f.kinopoiskId) === i);
    set({ items: next });
    writeFavorites(next);
  },
}));
