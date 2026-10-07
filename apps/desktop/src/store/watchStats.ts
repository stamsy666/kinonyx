import { create } from "zustand";

const KEY = "kinonyx.watchStats";

export type StatKind = "movie" | "series" | "tv";

export interface DayStat {
  movie: number;
  series: number;
  tv: number;
}

export interface TitleStat {
  title: string;
  poster?: string;
  kind: StatKind;
  /** Kinopoisk/TMDB id — lets the stats screen open the film (not set for TV channels). */
  filmId?: number;
  seconds: number;
  lastAt: number;
}

interface Data {
  /** Seconds watched per local calendar day, "YYYY-MM-DD". */
  days: Record<string, DayStat>;
  titles: Record<string, TitleStat>;
  genres: Record<string, number>;
  /** Seconds watched per hour of the day (index = hour). */
  hours: number[];
  since: number;
}

const empty = (): Data => ({ days: {}, titles: {}, genres: {}, hours: Array(24).fill(0), since: Date.now() });

function read(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<Data>;
      return { ...empty(), ...d, hours: Array.isArray(d.hours) && d.hours.length === 24 ? d.hours : Array(24).fill(0) };
    }
  } catch {
    /* falls through to empty */
  }
  return empty();
}

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface WatchMeta {
  /** Stable id of the title, e.g. "m:123" or "tv:<channel id>". */
  key: string;
  title: string;
  poster?: string;
  kind: StatKind;
  filmId?: number;
  genres?: string[];
}

interface State extends Data {
  add: (seconds: number, meta: WatchMeta) => void;
  reset: () => void;
}

let saveTimer = 0;
function scheduleSave(get: () => State) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const { days, titles, genres, hours, since } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ days, titles, genres, hours, since }));
    } catch {
      /* statistics just won't survive a restart */
    }
  }, 2000);
}

export const useWatchStats = create<State>((set, get) => ({
  ...read(),

  add(seconds, meta) {
    if (!(seconds > 0)) return;
    const now = new Date();
    const dk = dayKey(now);
    const s = get();
    const day = s.days[dk] ?? { movie: 0, series: 0, tv: 0 };
    const prev = s.titles[meta.key];
    const genres = { ...s.genres };
    for (const g of meta.genres ?? []) genres[g] = (genres[g] ?? 0) + seconds;
    const hours = s.hours.slice();
    hours[now.getHours()] += seconds;
    set({
      days: { ...s.days, [dk]: { ...day, [meta.kind]: day[meta.kind] + seconds } },
      titles: {
        ...s.titles,
        [meta.key]: {
          title: meta.title,
          poster: meta.poster ?? prev?.poster,
          kind: meta.kind,
          filmId: meta.filmId,
          seconds: (prev?.seconds ?? 0) + seconds,
          lastAt: Date.now(),
        },
      },
      genres,
      hours,
    });
    scheduleSave(get);
  },

  reset() {
    set(empty());
    scheduleSave(get);
  },
}));

// ---------- numbers for the screen ----------

export const totalOf = (d: DayStat) => d.movie + d.series + d.tv;

export function lastDays(days: Record<string, DayStat>, n: number, from = new Date()): { date: Date; seconds: number }[] {
  const out: { date: Date; seconds: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - i);
    const day = days[dayKey(d)];
    out.push({ date: d, seconds: day ? totalOf(day) : 0 });
  }
  return out;
}

/** Consecutive days (ending today, or yesterday if today is still empty) with at least a minute watched. */
export function streak(days: Record<string, DayStat>, from = new Date()): number {
  const watched = (d: Date) => {
    const x = days[dayKey(d)];
    return !!x && totalOf(x) >= 60;
  };
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (!watched(cursor)) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (watched(cursor)) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  if (m < 1) return sec >= 10 ? `${Math.round(sec)} с` : "—";
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} ч ${String(m % 60).padStart(2, "0")} мин` : `${m} мин`;
}

/** Period of the day with the most watching. */
export function favouriteTime(hours: number[]): string | undefined {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total < 60) return undefined;
  const parts: [string, number[]][] = [
    ["Ночь", [0, 1, 2, 3, 4, 5]],
    ["Утро", [6, 7, 8, 9, 10, 11]],
    ["День", [12, 13, 14, 15, 16, 17]],
    ["Вечер", [18, 19, 20, 21, 22, 23]],
  ];
  const best = parts.map(([name, hs]) => [name, hs.reduce((a, h) => a + hours[h], 0)] as const).sort((a, b) => b[1] - a[1])[0];
  return best[0];
}
