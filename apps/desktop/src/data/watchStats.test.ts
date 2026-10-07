import { describe, expect, it } from "vitest";
import { favouriteTime, formatDuration, lastDays, streak, type DayStat } from "../store/watchStats";

const day = (seconds: number): DayStat => ({ movie: seconds, series: 0, tv: 0 });

describe("streak", () => {
  const today = new Date(2026, 9, 7); // 7 Oct 2026
  it("counts consecutive days ending today", () => {
    expect(streak({ "2026-10-07": day(600), "2026-10-06": day(600), "2026-10-05": day(600), "2026-10-03": day(600) }, today)).toBe(3);
  });
  it("is still alive if today is empty but yesterday was watched", () => {
    expect(streak({ "2026-10-06": day(600), "2026-10-05": day(600) }, today)).toBe(2);
  });
  it("is 0 after a gap, and ignores less than a minute", () => {
    expect(streak({ "2026-10-04": day(600) }, today)).toBe(0);
    expect(streak({ "2026-10-07": day(30) }, today)).toBe(0);
  });
});

describe("lastDays", () => {
  it("returns n days ending today, zero-filled", () => {
    const r = lastDays({ "2026-10-07": day(120) }, 3, new Date(2026, 9, 7));
    expect(r.map((d) => d.seconds)).toEqual([0, 0, 120]);
  });
});

describe("formatting", () => {
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(25 * 60)).toBe("25 мин");
    expect(formatDuration(3600 * 2 + 5 * 60)).toBe("2 ч 05 мин");
  });
  it("finds the favourite time of day", () => {
    const hours = Array(24).fill(0);
    hours[21] = 7200;
    hours[8] = 600;
    expect(favouriteTime(hours)).toBe("Вечер");
    expect(favouriteTime(Array(24).fill(0))).toBeUndefined();
  });
});
