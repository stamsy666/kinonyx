import { describe, expect, it } from "vitest";
import { castFromStaff, glossaryFromFilm } from "./filmHints";

describe("castFromStaff", () => {
  it("takes actors' Russian character names, top-billed first, without duplicates", () => {
    const cast = castFromStaff([
      { staffId: 1, professionKey: "DIRECTOR", description: "Винс Гиллиган" },
      { staffId: 2, professionKey: "ACTOR", description: "Уолтер Уайт / Хайзенберг" },
      { staffId: 3, professionKey: "ACTOR", description: "Джесси Пинкман" },
      { staffId: 4, professionKey: "ACTOR", description: "уолтер уайт" },
      { staffId: 5, professionKey: "ACTOR", description: "Скайлер Уайт (в титрах не указана)" },
      { staffId: 6, professionKey: "ACTOR" },
    ]);
    expect(cast).toEqual(["Уолтер Уайт", "Хайзенберг", "Джесси Пинкман", "Скайлер Уайт"]);
  });

  it("ignores English-only character names (TMDB) and voice-role notes", () => {
    expect(
      castFromStaff([
        { staffId: 1, professionKey: "ACTOR", professionText: "Walter White", description: "Walter White" },
        { staffId: 2, professionKey: "ACTOR", description: "озвучка" },
      ]),
    ).toEqual([]);
  });

  it("stops at twelve names", () => {
    const staff = Array.from({ length: 30 }, (_, i) => ({ staffId: i, professionKey: "ACTOR", description: `Персонаж ${i}` }));
    expect(castFromStaff(staff)).toHaveLength(12);
  });
});

describe("glossaryFromFilm", () => {
  it("maps the original title to the Russian one", () => {
    expect(glossaryFromFilm({ nameRu: "Во все тяжкие", nameOriginal: "Breaking Bad" })).toEqual([["Breaking Bad", "Во все тяжкие"]]);
  });

  it("has nothing to say when the titles are the same or missing", () => {
    expect(glossaryFromFilm({ nameRu: "Брат", nameOriginal: "Брат" })).toEqual([]);
    expect(glossaryFromFilm({ nameRu: "Дюна" })).toEqual([]);
    expect(glossaryFromFilm(null)).toEqual([]);
  });
});
