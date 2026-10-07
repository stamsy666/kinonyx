import { describe, expect, it } from "vitest";
import { splitByYear, yearsIn } from "./releaseFilter";
import type { TorApiRelease } from "./api";

const r = (name: string) => ({ id: name, provider: "x", name }) as TorApiRelease;

describe("yearsIn", () => {
  it("finds years but not resolutions", () => {
    expect(yearsIn("Дюна / Dune (2021) BDRip 1080p")).toEqual([2021]);
    expect(yearsIn("Dune 2160p UHD")).toEqual([]);
    expect(yearsIn("Сериал (2019-2021) 720p")).toEqual([2019, 2021]);
  });
});

describe("splitByYear", () => {
  const list = [r("Дюна (2021) WEB-DL"), r("Дюна (1984) DVDRip"), r("Дюна BDRip"), r("Дюна: Часть вторая (2024)")];
  it("hides releases that name only another year, keeps unknown ones", () => {
    const { relevant, hidden } = splitByYear(list, 2021);
    expect(relevant.map((x) => x.name)).toEqual(["Дюна (2021) WEB-DL", "Дюна BDRip"]);
    expect(hidden).toHaveLength(2);
  });
  it("hides nothing when no result names the right year", () => {
    expect(splitByYear([r("Дюна (1984)"), r("Дюна (2024)")], 2021).hidden).toEqual([]);
  });
  it("does nothing without a year", () => {
    expect(splitByYear(list, undefined).relevant).toHaveLength(4);
  });
});
