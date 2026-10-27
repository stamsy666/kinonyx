import type { Chapter } from "@kinonyx/player-core";

/** A stretch of the picture the viewer can jump over: where the button shows and where it takes you. */
export interface SkipTarget {
  kind: "intro" | "credits";
  /** The button's text. */
  label: string;
  /** Seconds the jump lands on. */
  to: number;
}

// `\b` does not work for Cyrillic, so words are fenced by "not a letter".
const word = (alt: string) => new RegExp(String.raw`(^|[^\p{L}])(${alt})($|[^\p{L}])`, "iu");
const INTRO = word("op|opening|intro|заставка|опенинг|вступление|начальные титры|начало");
const CREDITS = word("ed|ending|outro|credits|end credits|титры|эндинг|конечные титры");

/** The chapter the position is inside and its end (the next mark, or the end of the file). */
function chapterAt(chapters: Chapter[], position: number, duration: number): { chapter: Chapter; end: number } | null {
  for (let i = 0; i < chapters.length; i++) {
    const end = chapters[i + 1]?.start ?? (Number.isFinite(duration) ? duration : Number.POSITIVE_INFINITY);
    if (position >= chapters[i].start && position < end) return { chapter: chapters[i], end };
  }
  return null;
}

/**
 * The file's own chapter marks: «Opening» / «Ending» are common in releases of series. The button shows through
 * the whole chapter except its last second, and jumps to where the chapter ends.
 */
export function skipFromChapters(chapters: Chapter[] | undefined, position: number, duration: number): SkipTarget | null {
  if (!chapters || chapters.length === 0) return null;
  const at = chapterAt(chapters, position, duration);
  if (!at || !Number.isFinite(at.end) || at.end - position < 1.5) return null;
  if (INTRO.test(at.chapter.title)) return { kind: "intro", label: "Пропустить заставку", to: at.end };
  if (CREDITS.test(at.chapter.title)) return { kind: "credits", label: "Пропустить титры", to: at.end };
  return null;
}

/** An intro the viewer jumped over by themselves in an earlier episode of the same series. */
export interface LearnedIntro {
  from: number;
  to: number;
}

/** The intro is in the first minutes; a jump over it is 25 s to 3 min long. */
const MAX_INTRO_START = 360;
const MAX_INTRO_END = 600;
const MIN_JUMP = 25;
const MAX_JUMP = 180;

/** A forward jump of the position that looks like skipping an intro (not a seek to the middle of the film). */
export function learnFromJump(prev: number, now: number): LearnedIntro | null {
  const jump = now - prev;
  if (prev < 0 || prev > MAX_INTRO_START || now > MAX_INTRO_END || jump < MIN_JUMP || jump > MAX_JUMP) return null;
  return { from: prev, to: now };
}

/** The learned intro, when the playhead is inside it (with a few seconds of leeway on either side). */
export function skipFromLearned(intro: LearnedIntro | undefined, position: number): SkipTarget | null {
  if (!intro) return null;
  if (position < intro.from - 6 || position >= intro.to - 2) return null;
  return { kind: "intro", label: "Пропустить заставку", to: intro.to };
}
