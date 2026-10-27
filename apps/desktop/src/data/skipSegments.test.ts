import { describe, expect, it } from "vitest";
import { findSkip, learnFromJump, skipFromChapters, skipFromLearned } from "./skipSegments";

const chapters = [
  { title: "Opening", start: 10 },
  { title: "Part A", start: 100 },
  { title: "Заставка", start: 1200 },
  { title: "Ending", start: 1290 },
];

describe("skipFromChapters", () => {
  it("is quiet far from the opening", () => {
    expect(skipFromChapters(chapters, 2, 1380)).toBeNull();
  });
  it("announces the opening five seconds ahead", () => {
    const s = skipFromChapters(chapters, 6, 1380)!;
    expect(s).toMatchObject({ kind: "intro", phase: "preview", startsIn: 4, from: 10, end: 100, to: 100 });
    expect(s.label).toBe("Заставка через 4 с");
  });
  it("offers the opening while it plays and lands on the next chapter", () => {
    const s = skipFromChapters(chapters, 40, 1380)!;
    expect(s).toMatchObject({ kind: "intro", phase: "inside", label: "Пропустить заставку", to: 100, toNext: false });
  });
  it("is quiet in an ordinary chapter and in the last second of the opening", () => {
    expect(skipFromChapters(chapters, 300, 1380)).toBeNull();
    expect(skipFromChapters(chapters, 99, 1380)).toBeNull();
  });
  it("offers the credits and lands at the end of the file", () => {
    const s = skipFromChapters(chapters, 1300, 1380)!;
    expect(s).toMatchObject({ kind: "credits", phase: "inside", label: "Пропустить титры", to: 1380, toNext: false });
  });
  it("turns the credits at the end of an episode into «next episode» when there is one", () => {
    const s = skipFromChapters(chapters, 1300, 1380, true)!;
    expect(s).toMatchObject({ kind: "credits", label: "Следующая серия", toNext: true });
    const tail = [{ title: "Part", start: 0 }, { title: "Ending", start: 1290 }];
    expect(skipFromChapters(tail, 1287, 1380, true)!.label).toBe("Следующая серия через 3 с");
  });
  it("understands Russian names and ignores words inside other words", () => {
    expect(skipFromChapters(chapters, 1210, 1380)?.kind).toBe("intro");
    expect(skipFromChapters([{ title: "Operation", start: 0 }, { title: "x", start: 100 }], 10, 200)).toBeNull();
  });
  it("is quiet without chapters", () => {
    expect(skipFromChapters(undefined, 10, 100)).toBeNull();
    expect(skipFromChapters([], 10, 100)).toBeNull();
  });
});

describe("learned intro", () => {
  it("learns a jump of the right size early in the episode", () => {
    expect(learnFromJump(65, 150)).toEqual({ from: 65, to: 150 });
  });
  it("does not learn small, huge or late jumps", () => {
    expect(learnFromJump(65, 80)).toBeNull();
    expect(learnFromJump(65, 400)).toBeNull();
    expect(learnFromJump(2000, 2090)).toBeNull();
  });
  it("announces and then offers the remembered window", () => {
    const intro = { from: 65, to: 150 };
    expect(skipFromLearned(intro, 62)).toMatchObject({ phase: "preview", startsIn: 3 });
    expect(skipFromLearned(intro, 100)).toMatchObject({ phase: "inside", to: 150 });
    expect(skipFromLearned(intro, 30)).toBeNull();
    expect(skipFromLearned(intro, 149)).toBeNull();
    expect(skipFromLearned(undefined, 100)).toBeNull();
  });
});

describe("findSkip", () => {
  it("prefers the chapters and ignores the learned intro of a film", () => {
    const a = { chapters, position: 40, duration: 1380, series: true, hasNext: true, learned: { from: 20, to: 60 } };
    expect(findSkip(a)?.to).toBe(100);
    expect(findSkip({ ...a, chapters: undefined, series: false })).toBeNull();
  });
});
