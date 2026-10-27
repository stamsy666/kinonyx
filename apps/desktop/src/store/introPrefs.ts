import type { LearnedIntro } from "../data/skipSegments";

const KEY = "kinonyx.learnedIntros";

function read(): Record<number, LearnedIntro> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Record<number, LearnedIntro>;
  } catch {
    /* falls through to empty */
  }
  return {};
}

export function getLearnedIntro(filmId: number): LearnedIntro | undefined {
  return read()[filmId];
}

/** The intro of a series as the viewer last jumped over it (the newest jump wins: an episode may have a cold open). */
export function learnIntro(filmId: number, intro: LearnedIntro): void {
  const all = read();
  // Several short jumps in a row (30 s at a time) make one long skip: a jump that starts where the last one landed
  // a moment ago extends it.
  const last = all[filmId] as (LearnedIntro & { at?: number }) | undefined;
  const now = Date.now();
  const continues = last?.at !== undefined && now - last.at < 20_000 && Math.abs(intro.from - last.to) <= 6 && last.to - last.from < 180;
  all[filmId] = (continues ? { from: last.from, to: intro.to, at: now } : { ...intro, at: now }) as LearnedIntro;
  const keys = Object.keys(all);
  if (keys.length > 200) delete all[Number(keys[0])];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* won't survive a restart */
  }
}
