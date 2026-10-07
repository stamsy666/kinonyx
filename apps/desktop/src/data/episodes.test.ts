import { describe, expect, it } from "vitest";
import { episodeKey, episodeLabel } from "./episodes";

const f = (name: string, path = name) => ({ name, path });

describe("episodeKey", () => {
  it("reads the common naming schemes", () => {
    expect(episodeKey(f("Show.S01E03.1080p.mkv"))).toBe("S01E03");
    expect(episodeKey(f("show 2x05 web-dl.mkv"))).toBe("S02E05");
    expect(episodeKey(f("Show - 07 серия.mkv"))).toBe("E07");
    expect(episodeKey(f("Show [12] 720p.mkv"))).toBe("E12");
  });

  it("takes the season from the folder when the file only has the episode", () => {
    expect(episodeKey(f("Серия 4.mkv", "Сезон 2/Серия 4.mkv"))).toBe("S02E04");
  });

  it("falls back to the file name", () => {
    expect(episodeKey(f("Movie.mkv"))).toBe("movie.mkv");
  });
});

describe("episodeLabel", () => {
  it("makes keys readable", () => {
    expect(episodeLabel("S01E03", "x")).toBe("1 сезон · 3 серия");
    expect(episodeLabel("E07", "x")).toBe("7 серия");
    expect(episodeLabel("movie.mkv", "movie.mkv")).toBe("movie.mkv");
  });
});
