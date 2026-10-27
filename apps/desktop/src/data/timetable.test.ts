import { describe, expect, it } from "vitest";
import { daysFrom, episodeCode, inWindow, pickNext, pickRecent, whenLabel } from "./timetable";

const NOW = new Date(2026, 9, 28, 15, 0).getTime(); // 28 October 2026, afternoon

describe("daysFrom / whenLabel", () => {
  it("counts calendar days, not hours", () => {
    expect(daysFrom("2026-10-28", NOW)).toBe(0);
    expect(daysFrom("2026-10-29", NOW)).toBe(1);
    expect(daysFrom("2026-10-25", NOW)).toBe(-3);
  });
  it("says it in words", () => {
    expect(whenLabel("2026-10-28", NOW)).toBe("сегодня");
    expect(whenLabel("2026-10-29", NOW)).toBe("завтра");
    expect(whenLabel("2026-10-31", NOW)).toBe("через 3 дня");
    expect(whenLabel("2026-11-02", NOW)).toBe("через 5 дней");
    expect(whenLabel("2026-10-27", NOW)).toBe("вчера");
    expect(whenLabel("2026-10-25", NOW)).toBe("3 дня назад");
  });
});

describe("window and picks", () => {
  it("keeps two weeks back and four months ahead", () => {
    expect(inWindow("2026-10-20", NOW)).toBe(true);
    expect(inWindow("2026-09-01", NOW)).toBe(false);
    expect(inWindow("2027-01-15", NOW)).toBe(true);
    expect(inWindow("2027-06-01", NOW)).toBe(false);
    expect(inWindow(undefined, NOW)).toBe(false);
  });
  const list = [
    { filmId: 1, season: 2, episode: 4, date: "2026-10-30" },
    { filmId: 1, season: 2, episode: 5, date: "2026-11-06" },
    { filmId: 1, season: 2, episode: 3, date: "2026-10-23" },
    { filmId: 2, season: 1, episode: 1, date: "2026-10-27" },
  ];
  it("takes the nearest coming episode of each film", () => {
    expect(pickNext(list, NOW).map((e) => [e.filmId, e.episode])).toEqual([[1, 4]]);
  });
  it("takes the latest episode out of each film, the newest first", () => {
    expect(pickRecent(list, NOW).map((e) => [e.filmId, e.episode])).toEqual([[2, 1], [1, 3]]);
  });
  it("writes the code of an episode", () => {
    expect(episodeCode({ season: 2, episode: 5 })).toBe("S02E05");
  });
});
