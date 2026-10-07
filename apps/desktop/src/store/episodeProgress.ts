import { create } from "zustand";
import type { TorrentFile } from "../data/api";
import { episodeKey, episodeLabel } from "../data/episodes";

const KEY = "kinonyx.episodeProgress";
/** Past this fraction of the episode (credits don't count) it is "watched". */
const WATCHED_FRACTION = 0.92;
/** Below this, "resume" isn't meaningfully different from starting over. */
const MIN_RESUME = 20;

export interface EpisodeEntry {
  position: number;
  duration: number;
  watched: boolean;
  updatedAt: number;
}

interface FilmEntry {
  episodes: Record<string, EpisodeEntry>;
  /** The episode touched last, for the "Продолжить" label on the film page. */
  lastKey?: string;
  lastLabel?: string;
}

type Data = Record<number, FilmEntry>;

function read(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Data;
  } catch {
    /* falls through to empty */
  }
  return {};
}

function write(d: Data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* progress just won't survive a restart */
  }
}

interface State {
  data: Data;
  report: (filmId: number, key: string, fallbackLabel: string, position: number, duration: number) => void;
  markWatched: (filmId: number, key: string) => void;
  entry: (filmId: number, key: string) => EpisodeEntry | undefined;
  /** Where to resume this episode (0 = from the start). */
  resumeAt: (filmId: number, key: string) => number;
  /** The episode to start for a "Смотреть" press: the one in progress, else the one after the last watched. */
  smartPick: (filmId: number, files: TorrentFile[]) => TorrentFile | undefined;
}

export const useEpisodeProgress = create<State>((set, get) => ({
  data: read(),

  report(filmId, key, fallbackLabel, position, duration) {
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return;
    const film: FilmEntry = get().data[filmId] ?? { episodes: {} };
    const prev = film.episodes[key];
    const watched = prev?.watched || position / duration >= WATCHED_FRACTION;
    const next: Data = {
      ...get().data,
      [filmId]: {
        ...film,
        lastKey: key,
        lastLabel: episodeLabel(key, fallbackLabel),
        episodes: { ...film.episodes, [key]: { position, duration, watched, updatedAt: Date.now() } },
      },
    };
    set({ data: next });
    write(next);
  },

  markWatched(filmId, key) {
    const film: FilmEntry = get().data[filmId] ?? { episodes: {} };
    const prev = film.episodes[key];
    if (!prev) return;
    const next: Data = { ...get().data, [filmId]: { ...film, episodes: { ...film.episodes, [key]: { ...prev, watched: true } } } };
    set({ data: next });
    write(next);
  },

  entry: (filmId, key) => get().data[filmId]?.episodes[key],

  resumeAt(filmId, key) {
    const e = get().data[filmId]?.episodes[key];
    if (!e || e.watched || e.position < MIN_RESUME || e.position > e.duration - 5) return 0;
    return e.position;
  },

  smartPick(filmId, files) {
    const eps = get().data[filmId]?.episodes;
    if (!eps || files.length === 0) return undefined;
    const keyed = files.map((file) => ({ file, key: episodeKey(file) }));
    // 1. An episode left half-watched — the most recent one.
    const inProgress = keyed
      .filter(({ key }) => {
        const e = eps[key];
        return e && !e.watched && e.position >= MIN_RESUME;
      })
      .sort((a, b) => eps[b.key].updatedAt - eps[a.key].updatedAt)[0];
    if (inProgress) return inProgress.file;
    // 2. The episode after the one watched last.
    const lastWatched = keyed
      .map((k, i) => ({ ...k, i }))
      .filter(({ key }) => eps[key]?.watched)
      .sort((a, b) => eps[b.key].updatedAt - eps[a.key].updatedAt)[0];
    if (lastWatched) return keyed[lastWatched.i + 1]?.file ?? undefined;
    return undefined;
  },
}));

/** Label for the film page's main button once a series has been started. */
export function continueLabel(filmId: number): string | undefined {
  const film = useEpisodeProgress.getState().data[filmId];
  if (!film?.lastKey) return undefined;
  const e = film.episodes[film.lastKey];
  if (!e) return undefined;
  return e.watched ? `Дальше · после ${film.lastLabel}` : `Продолжить · ${film.lastLabel}`;
}
