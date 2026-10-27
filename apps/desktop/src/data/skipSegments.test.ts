import { describe, expect, it } from "vitest";
import { learnFromJump, skipFromChapters, skipFromLearned } from "./skipSegments";

const chapters = [
  { title: "Opening", start: 0 },
  { title: "Part A", start: 90 },
  { title: "Заставка", start: 1200 },
  { title: "Ending", start: 1290 },
];

describe("skipFromChapters", () => {
  it("offers the opening while it plays and lands on the next chapter", () => {
    expect(skipFromChapters(chapters, 10, 1380)).toEqual({ kind: "intro", label: "Пропустить заставку", to: 90 });
  });
  it("is quiet in an ordinary chapter and in the last second of the opening", () => {
    expect(skipFromChapters(chapters, 300, 1380)).toBeNull();
    expect(skipFromChapters(chapters, 89, 1380)).toBeNull();
  });
  it("offers the credits and lands at the end of the file", () => {
    expect(skipFromChapters(chapters, 1300, 1380)).toEqual({ kind: "credits", label: "Пропустить титры", to: 1380 });
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
  it("shows the button inside the remembered window only", () => {
    const intro = { from: 65, to: 150 };
    expect(skipFromLearned(intro, 62)?.to).toBe(150);
    expect(skipFromLearned(intro, 100)?.to).toBe(150);
    expect(skipFromLearned(intro, 30)).toBeNull();
    expect(skipFromLearned(intro, 149)).toBeNull();
    expect(skipFromLearned(undefined, 100)).toBeNull();
  });
});
