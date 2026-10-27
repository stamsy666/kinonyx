import { kpFilm, kpSearch, type KpCollectionItem, type MetadataSource } from "./api";
import { pickByImdb, pickCandidate, type FilmKey } from "./matchTitle";
import { imdbFor } from "./imdbIds";
import { useFavorites } from "../store/favorites";
import { useContinueWatching } from "../store/continueWatching";
import { useLastRelease } from "../store/lastRelease";

/** Entries saved before sources existed came from Kinopoisk. */
const sourceOf = (s: MetadataSource | undefined): MetadataSource => s ?? "kinopoisk";

/** How many of a search's first results are asked for their IMDb id (one request each; the limit of a key is small). */
const VERIFY = 3;

async function findMatch(key: FilmKey, imdb?: string): Promise<KpCollectionItem | undefined> {
  let byTitle: KpCollectionItem | undefined;
  // Original title first: it's the same string in every source, Russian ones differ.
  for (const query of [key.nameOriginal, key.nameRu]) {
    if (!query?.trim()) continue;
    const results = await kpSearch(query.trim());
    if (imdb) {
      // The IMDb id is the same in every source: the very film, even if the sources call it differently.
      const ids = new Map<number, string | null | undefined>();
      for (const r of results.slice(0, VERIFY)) {
        try {
          ids.set(r.kinopoiskId, (await kpFilm(r.kinopoiskId)).imdbId);
        } catch {
          /* this one cannot be checked: the title decides below */
        }
      }
      const exact = pickByImdb(imdb, results, ids);
      if (exact) return exact;
    }
    byTitle ??= pickCandidate(key, results);
  }
  return byTitle;
}

let running: Promise<void> | null = null;

/** Re-points favorites, "continue watching" and remembered releases at `target`'s ids.
 *  Runs in the background; entries it can't match (or can't reach the source for, e.g. no
 *  VPN) stay as they are and are retried on the next start. Idempotent. */
export function rematchAll(target: MetadataSource): Promise<void> {
  running = (running ?? Promise.resolve()).then(() => run(target)).catch(() => undefined);
  return running;
}

async function run(target: MetadataSource) {
  type Job = { key: FilmKey; imdb?: string; apply: (hit: KpCollectionItem) => void };
  const jobs: Job[] = [];
  const idMap = new Map<number, number>();

  for (const fav of useFavorites.getState().items) {
    if (sourceOf(fav.source) === target) continue;
    jobs.push({
      key: fav,
      imdb: imdbFor(sourceOf(fav.source), fav.kinopoiskId),
      apply: (hit) => {
        idMap.set(fav.kinopoiskId, hit.kinopoiskId);
        useFavorites.getState().replace(fav.kinopoiskId, { ...fav, ...hit, source: target });
      },
    });
  }
  for (const e of useContinueWatching.getState().items) {
    if (sourceOf(e.source) === target || !e.film) continue;
    jobs.push({
      key: e.film,
      imdb: imdbFor(sourceOf(e.source), e.filmId),
      apply: (hit) => {
        idMap.set(e.filmId, hit.kinopoiskId);
        useContinueWatching.getState().remap(e.filmId, hit.kinopoiskId, target);
      },
    });
  }

  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        const hit = await findMatch(job.key, job.imdb);
        if (hit) job.apply(hit);
      } catch {
        /* source unreachable — leave the entry, try again next start */
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  // Remembered releases hang off the film id; follow the ones whose film was re-pointed.
  for (const [from, to] of idMap) useLastRelease.getState().remap(from, to);
}
