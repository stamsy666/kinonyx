import { describe, expect, it } from "vitest";
import { normalizeTitle, pickCandidate } from "./matchTitle";

const r = (id: number, nameRu: string, nameOriginal: string, year: number) => ({
  kinopoiskId: id,
  nameRu,
  nameOriginal,
  year,
});

describe("normalizeTitle", () => {
  it("ignores case, ё and punctuation", () => {
    expect(normalizeTitle("Ёжик: в тумане!")).toBe("ежиквтумане");
    expect(normalizeTitle(undefined)).toBe("");
  });
});

describe("pickCandidate", () => {
  const results = [
    r(1, "Дюна", "Dune", 1984),
    r(2, "Дюна", "Dune", 2021),
    r(3, "Дюна: Часть вторая", "Dune: Part Two", 2024),
  ];

  it("matches by title and picks the right year", () => {
    expect(pickCandidate({ nameRu: "Дюна", year: 2021 }, results)?.kinopoiskId).toBe(2);
  });

  it("tolerates a one-year disagreement but not more", () => {
    expect(pickCandidate({ nameOriginal: "Dune", year: "2022" }, results)?.kinopoiskId).toBe(2);
    expect(pickCandidate({ nameOriginal: "Dune", year: 2010 }, results)).toBeUndefined();
  });

  it("matches on either language and without a year", () => {
    expect(pickCandidate({ nameOriginal: "dune: part two" }, results)?.kinopoiskId).toBe(3);
  });

  it("gives nothing for an unrelated title or an empty key", () => {
    expect(pickCandidate({ nameRu: "Маяк", year: 2024 }, results)).toBeUndefined();
    expect(pickCandidate({}, results)).toBeUndefined();
  });
});
