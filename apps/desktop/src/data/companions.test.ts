import { describe, expect, it } from "vitest";
import { langOfName, pickCompanions } from "./companions";

const f = (id: number, path: string) => ({ id, path, name: path.split("/").pop()!, length: 1 });

describe("pickCompanions: a film", () => {
  const files = [
    f(1, "Film.2021/Film.2021.mkv"),
    f(2, "Film.2021/Subs/Film.2021.Rus.srt"),
    f(3, "Film.2021/Subs/Film.2021.Eng.srt"),
    f(4, "Film.2021/Audio/Film.2021.Rus.DUB.ac3"),
    f(5, "Film.2021/poster.jpg"),
    f(6, "Film.2021/sample.mkv"),
  ];
  it("takes the subtitles and the sound tracks of its folder, not pictures or samples", () => {
    const out = pickCompanions(files, files[0], [files[0]]);
    expect(out.subs.map((x) => x.id)).toEqual([2, 3]);
    expect(out.audio.map((x) => x.id)).toEqual([4]);
  });
});

describe("pickCompanions: a pack of episodes", () => {
  const files = [
    f(1, "Show/Show.S01E01.mkv"),
    f(2, "Show/Show.S01E02.mkv"),
    f(3, "Show/Subs/Show.S01E01.rus.srt"),
    f(4, "Show/Subs/Show.S01E02.rus.srt"),
    f(5, "Show/Subs/Show.S01E02.eng.ass"),
    f(6, "Show/Audio/Show.S01E02.dub.mka"),
  ];
  it("takes only what is named for the same episode", () => {
    const videos = [files[0], files[1]];
    const out = pickCompanions(files, files[1], videos);
    expect(out.subs.map((x) => x.id)).toEqual([4, 5]);
    expect(out.audio.map((x) => x.id)).toEqual([6]);
    expect(pickCompanions(files, files[0], videos).subs.map((x) => x.id)).toEqual([3]);
  });
});

describe("langOfName", () => {
  it("reads a language off a file name", () => {
    expect(langOfName("Film.Rus.srt")).toBe("rus");
    expect(langOfName("Film.2021.eng.forced.srt")).toBe("eng");
    expect(langOfName("Фильм.рус.srt")).toBe("rus");
    expect(langOfName("Film.srt")).toBeUndefined();
  });
});
