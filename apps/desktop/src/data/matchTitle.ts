import type { KpCollectionItem } from "./api";

/** What identifies a film across sources — Kinopoisk and TMDB number films differently,
 *  so after a source switch the only thing the two share is the name and the year. */
export interface FilmKey {
  nameRu?: string;
  nameOriginal?: string;
  year?: string | number;
}

export function normalizeTitle(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const yearOf = (y: string | number | undefined) => {
  const n = Number.parseInt(String(y ?? ""), 10);
  return Number.isFinite(n) ? n : undefined;
};

/** The first search result with the same title (Russian or original) and a year within ±1
 *  (sources disagree about festival-vs-premiere years). Unknown year on either side → the
 *  title alone has to match. */
export function pickCandidate(entry: FilmKey, results: KpCollectionItem[]): KpCollectionItem | undefined {
  const names = [entry.nameRu, entry.nameOriginal].map(normalizeTitle).filter(Boolean);
  if (!names.length) return undefined;
  const wanted = yearOf(entry.year);
  return results.find((r) => {
    const theirs = [r.nameRu, r.nameOriginal].map(normalizeTitle).filter(Boolean);
    if (!theirs.some((n) => names.includes(n))) return false;
    const got = yearOf(r.year);
    return wanted === undefined || got === undefined || Math.abs(wanted - got) <= 1;
  });
}

/** The candidate that is the very film with this IMDb id (`imdbs` are the candidates' ids, by film id); the title is not looked at. */
export function pickByImdb(wanted: string | undefined, results: KpCollectionItem[], imdbs: Map<number, string | null | undefined>): KpCollectionItem | undefined {
  if (!wanted) return undefined;
  return results.find((r) => imdbs.get(r.kinopoiskId) === wanted);
}
