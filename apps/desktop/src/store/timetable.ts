import { create } from "zustand";
import { isTauri } from "../data/io";
import { kpSeasons, type KpCollectionItem } from "../data/api";
import { daysFrom, episodeCode, inWindow, type TimetableEpisode } from "../data/timetable";
import { useFavorites } from "./favorites";
import { useNotices } from "./notifications";

const KEY = "kinonyx.timetable";
const SERIES_EVERY_MS = 12 * 3_600_000;
const NOT_A_SERIES_MS = 3 * 86_400_000;
const MAX_FILMS = 25;

interface Saved {
  episodes: TimetableEpisode[];
  /** When a film may be looked into again (ms). */
  next: Record<number, number>;
  /** Episodes already announced in the bell. */
  notified: string[];
}

function read(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { episodes: [], next: {}, notified: [], ...(JSON.parse(raw) as Partial<Saved>) };
  } catch {
    /* falls through to empty */
  }
  return { episodes: [], next: {}, notified: [] };
}

interface TimetableState extends Saved {
  refresh: () => Promise<void>;
}

/** Which favourites may be a series: a series by its type, a TMDB series by its shifted id, and the ones whose type is not known yet. */
function mayBeSeries(f: KpCollectionItem): boolean {
  if (f.type) return /SERIES|SHOW/i.test(f.type);
  return true;
}

let running = false;

export const useTimetable = create<TimetableState>((set, get) => ({
  ...read(),
  async refresh() {
    if (!isTauri || running) return;
    running = true;
    try {
      const now = Date.now();
      const films = useFavorites.getState().items.filter(mayBeSeries).slice(0, MAX_FILMS);
      let { episodes } = get();
      const next = { ...get().next };
      // Films that left the favourites leave the schedule.
      const ids = new Set(films.map((f) => f.kinopoiskId));
      episodes = episodes.filter((e) => ids.has(e.filmId));
      for (const film of films) {
        if ((next[film.kinopoiskId] ?? 0) > now) continue;
        let found: TimetableEpisode[] = [];
        try {
          const r = await kpSeasons(film.kinopoiskId);
          found = (r.items ?? []).flatMap((s) =>
            (s.episodes ?? [])
              .filter((e) => inWindow(e.releaseDate, now))
              .map((e) => ({ filmId: film.kinopoiskId, season: e.seasonNumber ?? s.number, episode: e.episodeNumber, name: e.nameRu || e.nameEn || undefined, date: e.releaseDate!.slice(0, 10) })),
          );
          // Nothing at all: not a series (or nothing is coming) — not asked again for a few days.
          next[film.kinopoiskId] = now + ((r.items ?? []).length === 0 ? NOT_A_SERIES_MS : SERIES_EVERY_MS);
        } catch {
          next[film.kinopoiskId] = now + 3_600_000;
        }
        episodes = [...episodes.filter((e) => e.filmId !== film.kinopoiskId), ...found];
        // A pause between films: the key of Kinopoisk has a small daily allowance.
        await new Promise((r) => setTimeout(r, 400));
      }

      // The bell: an episode that came out in the last three days, once.
      const notified = new Set(get().notified);
      for (const e of episodes) {
        const d = daysFrom(e.date, now);
        const id = `ep:${e.filmId}:${episodeCode(e)}`;
        if (d === undefined || d > 0 || d < -3 || notified.has(id)) continue;
        const film = films.find((f) => f.kinopoiskId === e.filmId);
        useNotices.getState().add({
          id,
          kind: "episode",
          title: film?.nameRu || film?.nameOriginal || "Новая серия",
          text: `Вышла серия ${episodeCode(e)}${e.name ? ` — ${e.name}` : ""}`,
          filmId: e.filmId,
          poster: film?.posterUrlPreview,
        });
        notified.add(id);
      }

      const saved: Saved = { episodes, next, notified: [...notified].slice(-300) };
      set(saved);
      try {
        localStorage.setItem(KEY, JSON.stringify(saved));
      } catch {
        /* the schedule is made again */
      }
    } finally {
      running = false;
    }
  },
}));

/** The schedule is kept up to date: a few seconds after the start, every three hours, and when the favourites change. */
export function startTimetableLoop(): void {
  if (!isTauri) return;
  window.setTimeout(() => void useTimetable.getState().refresh(), 12_000);
  window.setInterval(() => void useTimetable.getState().refresh(), 3 * 3_600_000);
  let last = useFavorites.getState().items.length;
  let timer = 0;
  useFavorites.subscribe((s) => {
    if (s.items.length === last) return;
    last = s.items.length;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void useTimetable.getState().refresh(), 4000);
  });
}
