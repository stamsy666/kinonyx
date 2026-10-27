import type { Chapter } from "@kinonyx/player-core";

/**
 * A stretch of the picture the viewer can jump over (an intro, the credits). The button is announced a few seconds before the
 * stretch begins ("Заставка через 5 с"), is pressable inside it, and shows how much of it is left.
 */
export interface SkipTarget {
  kind: "intro" | "credits";
  /** "preview": it is about to begin; "inside": it is on. */
  phase: "preview" | "inside";
  /** The words on the button (inside) or in the announcement (before). */
  label: string;
  /** Seconds the jump lands on. */
  to: number;
  /** Where the stretch begins and ends, for the bar and the countdown. */
  from: number;
  end: number;
  /** Seconds before it begins (the preview only). */
  startsIn: number;
  /** The credits at the end of a series' episode: the jump is to the next episode, not to a place in this one. */
  toNext: boolean;
}

/** How long before a stretch it is announced. */
export const PREVIEW_S = 5;

// `\\b` does not work for Cyrillic, so words are fenced by "not a letter".
const word = (alt: string) => new RegExp(String.raw`(^|[^\p{L}])(${alt})($|[^\p{L}])`, "iu");
const INTRO = word("op|opening|intro|заставка|опенинг|вступление|начальные титры|начало");
const CREDITS = word("ed|ending|outro|credits|end credits|титры|эндинг|конечные титры");

/** How close to the end of the file the credits have to be for the button to say "next episode". */
const END_SLACK_S = 25;

function make(kind: SkipTarget["kind"], from: number, end: number, position: number, duration: number, hasNext: boolean): SkipTarget | null {
  if (!Number.isFinite(end)) return null;
  const toNext = kind === "credits" && hasNext && Number.isFinite(duration) && end >= duration - END_SLACK_S;
  const intro = kind === "intro";
  if (position < from) {
    const startsIn = Math.ceil(from - position);
    if (startsIn > PREVIEW_S) return null;
    return {
      kind,
      phase: "preview",
      label: toNext ? `Следующая серия через ${startsIn} с` : `${intro ? "Заставка" : "Титры"} через ${startsIn} с`,
      to: end,
      from,
      end,
      startsIn,
      toNext,
    };
  }
  if (end - position < 1.5) return null;
  return {
    kind,
    phase: "inside",
    label: toNext ? "Следующая серия" : intro ? "Пропустить заставку" : "Пропустить титры",
    to: end,
    from,
    end,
    startsIn: 0,
    toNext,
  };
}

/**
 * The file's own chapter marks: «Opening» / «Ending» are common in releases of series. The button is announced five seconds
 * before the chapter, stays through it (except its last second) and jumps to where it ends.
 */
export function skipFromChapters(chapters: Chapter[] | undefined, position: number, duration: number, hasNext = false): SkipTarget | null {
  if (!chapters || chapters.length === 0) return null;
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i];
    const kind = INTRO.test(c.title) ? "intro" : CREDITS.test(c.title) ? "credits" : null;
    if (!kind) continue;
    const end = chapters[i + 1]?.start ?? (Number.isFinite(duration) ? duration : Number.POSITIVE_INFINITY);
    if (position >= c.start - PREVIEW_S && position < end) return make(kind, c.start, end, position, duration, hasNext);
  }
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

/** The learned intro, announced before it and offered inside it (a few seconds of leeway before the end). */
export function skipFromLearned(intro: LearnedIntro | undefined, position: number, duration = Number.NaN): SkipTarget | null {
  if (!intro) return null;
  if (position < intro.from - PREVIEW_S || position >= intro.to - 2) return null;
  return make("intro", intro.from, intro.to, position, duration, false);
}

/** What the player shows: the chapters first, then (in a series) what the viewer skipped before. */
export function findSkip(opts: {
  chapters?: Chapter[];
  learned?: LearnedIntro;
  position: number;
  duration: number;
  series: boolean;
  hasNext: boolean;
}): SkipTarget | null {
  return skipFromChapters(opts.chapters, opts.position, opts.duration, opts.series && opts.hasNext) ?? (opts.series ? skipFromLearned(opts.learned, opts.position, opts.duration) : null);
}
