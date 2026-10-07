import { describe, expect, it } from "vitest";
import { applyFilters, hasActiveFilters, nextStep, RATING_STEPS, toKpFilter } from "./searchFilters";

const film = (id: number, year: number, rating: number | undefined, genre: string, type?: string) => ({
  kinopoiskId: id,
  year,
  ratingKinopoisk: rating,
  genres: [{ genre }],
  type,
});

const items = [
  film(1, 1999, 8.4, "драма", "FILM"),
  film(2, 2022, 6.1, "комедия", "FILM"),
  film(3, 2023, 7.9, "драма", "TV_SERIES"),
  film(4, 2021, undefined, "драма"),
];

describe("applyFilters", () => {
  it("filters by kind, using the id shift when a result has no type", () => {
    expect(applyFilters(items, { kind: "TV_SERIES" }).map((i) => i.kinopoiskId)).toEqual([3]);
    expect(applyFilters(items, { kind: "FILM" }).map((i) => i.kinopoiskId)).toEqual([1, 2, 4]);
    expect(applyFilters([film(1_000_000_005, 2020, 7, "драма")], { kind: "TV_SERIES" })).toHaveLength(1);
  });

  it("combines genre, year and rating; unknown rating passes", () => {
    const got = applyFilters(items, { kind: "ALL", genre: { id: 1, name: "Драма" }, yearFrom: 2000, ratingFrom: 7 });
    expect(got.map((i) => i.kinopoiskId)).toEqual([3, 4]);
  });
});

describe("helpers", () => {
  it("detects active filters and builds the API filter", () => {
    expect(hasActiveFilters({ kind: "ALL" })).toBe(false);
    expect(hasActiveFilters({ kind: "ALL", ratingFrom: 6 })).toBe(true);
    expect(toKpFilter({ kind: "FILM", genre: { id: 3, name: "x" }, yearFrom: 2010 })).toMatchObject({ kind: "FILM", genre: 3, yearFrom: 2010 });
  });

  it("cycles through steps and wraps to any", () => {
    expect(nextStep(RATING_STEPS, undefined)).toBe(6);
    expect(nextStep(RATING_STEPS, 8)).toBeUndefined();
  });
});
