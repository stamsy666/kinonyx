import type { KpCollectionItem, KpFilter } from "./api";

export type SearchKind = "ALL" | "FILM" | "TV_SERIES";

export interface SearchFilters {
  kind: SearchKind;
  /** Genre id from `kpGenres()` (and its name — the text search only has names). */
  genre?: { id: number; name: string };
  yearFrom?: number;
  ratingFrom?: number;
}

export const DEFAULT_FILTERS: SearchFilters = { kind: "ALL" };

export const YEAR_STEPS: (number | undefined)[] = [undefined, 2020, 2010, 2000, 1990, 1970];
export const RATING_STEPS: (number | undefined)[] = [undefined, 6, 7, 8];

/** Next value in a cycling chip, wrapping back to "any". */
export function nextStep<T>(steps: T[], current: T): T {
  const i = steps.indexOf(current);
  return steps[(i + 1) % steps.length];
}

export const hasActiveFilters = (f: SearchFilters) =>
  f.kind !== "ALL" || f.genre !== undefined || f.yearFrom !== undefined || f.ratingFrom !== undefined;

/** Filters → the request `kpFilmsFilter` understands (used when there's no text query). */
export function toKpFilter(f: SearchFilters): KpFilter {
  return { kind: f.kind, genre: f.genre?.id, ratingFrom: f.ratingFrom, yearFrom: f.yearFrom, order: "NUM_VOTE" };
}

/** TMDB series ids are shifted by a billion (see tmdb.rs) — usable when a result has no `type`. */
const isSeries = (item: KpCollectionItem) =>
  item.type ? /SERIES/i.test(item.type) : item.kinopoiskId >= 1_000_000_000;

/** Text search can't be filtered server-side (keyword search takes no filters), so the
 *  result list is trimmed here instead. Unknown year/rating pass — dropping a film because
 *  the source didn't say would hide exactly the obscure titles people search for by name. */
export function applyFilters(items: KpCollectionItem[], f: SearchFilters): KpCollectionItem[] {
  return items.filter((it) => {
    if (f.kind === "FILM" && isSeries(it)) return false;
    if (f.kind === "TV_SERIES" && !isSeries(it)) return false;
    if (f.genre) {
      const wanted = f.genre.name.toLowerCase();
      if (it.genres?.length && !it.genres.some((g) => g.genre.toLowerCase() === wanted)) return false;
    }
    const year = Number.parseInt(String(it.year ?? ""), 10);
    if (f.yearFrom !== undefined && Number.isFinite(year) && year < f.yearFrom) return false;
    if (f.ratingFrom !== undefined && it.ratingKinopoisk !== undefined && it.ratingKinopoisk < f.ratingFrom) return false;
    return true;
  });
}

const KEY = "kinonyx.searchFilters";

export function readFilters(): SearchFilters {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_FILTERS, ...(JSON.parse(raw) as Partial<SearchFilters>) };
  } catch {
    /* falls through to defaults */
  }
  return DEFAULT_FILTERS;
}

export function writeFilters(f: SearchFilters) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    /* filters just reset next start */
  }
}
