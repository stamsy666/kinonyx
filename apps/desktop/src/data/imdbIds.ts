import { kpFilm, type MetadataSource } from "./api";

const KEY = "kinonyx.imdbIds";
const MAX = 3000;

/** Film id in a source → IMDb id: the one thing Kinopoisk and TMDB both know, so a switch of the source finds the same film
 *  exactly, not by name and year. Filled when a film is saved or started (one request, usually already cached). */
function read(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Record<string, string>;
  } catch {
    /* falls through to empty */
  }
  return {};
}

const keyOf = (source: MetadataSource, id: number) => `${source}:${id}`;

export function imdbFor(source: MetadataSource, id: number): string | undefined {
  return read()[keyOf(source, id)];
}

export function rememberImdb(source: MetadataSource, id: number, imdb: string | null | undefined): void {
  if (!imdb || !/^tt\d+$/.test(imdb)) return;
  const all = read();
  if (all[keyOf(source, id)] === imdb) return;
  all[keyOf(source, id)] = imdb;
  const keys = Object.keys(all);
  if (keys.length > MAX) delete all[keys[0]];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* the match just falls back to the title */
  }
}

/** Looks the id up if it is not known yet (and the source answers). Never throws. */
export async function captureImdb(source: MetadataSource, id: number): Promise<void> {
  if (imdbFor(source, id)) return;
  try {
    rememberImdb(source, id, (await kpFilm(id)).imdbId);
  } catch {
    /* no network or no VPN: next time */
  }
}
