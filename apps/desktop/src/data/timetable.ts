/** The schedule of new episodes of the viewer's favourite series: what came out in the last two weeks and what is coming. */
export interface TimetableEpisode {
  filmId: number;
  season: number;
  episode: number;
  name?: string;
  /** "2026-11-05" */
  date: string;
}

const DAY = 86_400_000;
export const RECENT_DAYS = 14;
export const AHEAD_DAYS = 120;

/** The start of a calendar day (local) from "yyyy-mm-dd". */
export function dayStart(date: string): number | undefined {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

export const todayStart = (now = Date.now()) => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Days from today: 0 — today, 1 — tomorrow, -1 — yesterday. */
export function daysFrom(date: string, now = Date.now()): number | undefined {
  const d = dayStart(date);
  return d === undefined ? undefined : Math.round((d - todayStart(now)) / DAY);
}

/** Only the episodes worth keeping: out within the last two weeks or coming within four months. */
export function inWindow(date: string | undefined, now = Date.now()): boolean {
  if (!date) return false;
  const d = daysFrom(date, now);
  return d !== undefined && d >= -RECENT_DAYS && d <= AHEAD_DAYS;
}

/** "завтра", "через 3 дня", "сегодня", "вчера", "3 дня назад". */
export function whenLabel(date: string, now = Date.now()): string {
  const d = daysFrom(date, now);
  if (d === undefined) return date;
  const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "день" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "дня" : "дней");
  if (d === 0) return "сегодня";
  if (d === 1) return "завтра";
  if (d === -1) return "вчера";
  if (d > 1) return `через ${d} ${plural(d)}`;
  return `${-d} ${plural(-d)} назад`;
}

/** One episode per film: the nearest coming one / the latest out one. */
export function pickNext(list: TimetableEpisode[], now = Date.now()): TimetableEpisode[] {
  const out = new Map<number, TimetableEpisode>();
  for (const e of list) {
    const d = daysFrom(e.date, now);
    if (d === undefined || d < 0) continue;
    const have = out.get(e.filmId);
    if (!have || (daysFrom(have.date, now) ?? 0) > d) out.set(e.filmId, e);
  }
  return [...out.values()].sort((a, b) => (dayStart(a.date) ?? 0) - (dayStart(b.date) ?? 0));
}

export function pickRecent(list: TimetableEpisode[], now = Date.now()): TimetableEpisode[] {
  const out = new Map<number, TimetableEpisode>();
  for (const e of list) {
    const d = daysFrom(e.date, now);
    if (d === undefined || d > 0) continue;
    const have = out.get(e.filmId);
    if (!have || (daysFrom(have.date, now) ?? 0) < d) out.set(e.filmId, e);
  }
  return [...out.values()].sort((a, b) => (dayStart(b.date) ?? 0) - (dayStart(a.date) ?? 0));
}

export const episodeCode = (e: { season: number; episode: number }) => `S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}`;
