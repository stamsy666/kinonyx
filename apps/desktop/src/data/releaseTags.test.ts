import { describe, expect, it } from "vitest";
import { parseTags, tagLabels } from "./releaseTags";

describe("parseTags", () => {
  it("reads a typical film release", () => {
    const t = parseTags("Дюна / Dune (2021) BDRemux 2160p HEVC HDR10 | Dub, MVO | LostFilm");
    expect(t).toMatchObject({ quality: "4K", source: "Remux", hdr: "HDR", codec: "HEVC", voice: "Дубляж", studio: "LostFilm" });
  });
  it("tells Dolby Vision and HDR10+ from plain HDR", () => {
    expect(parseTags("Film 2023 WEB-DL 2160p DV HEVC").hdr).toBe("Dolby Vision");
    expect(parseTags("Film 2023 WEB-DL 2160p HDR10+ HEVC").hdr).toBe("HDR10+");
  });
  it("reads the kind of voice-over", () => {
    expect(parseTags("Сериал S01 WEB-DL 1080p | MVO").voice).toBe("Многоголосая");
    expect(parseTags("Фильм 720p DVO").voice).toBe("Двухголосая");
    expect(parseTags("Фильм 1080p | Original").voice).toBe("Оригинал");
  });
  it("does not take a word inside another word", () => {
    expect(parseTags("Operation Fortune 1080p").voice).toBeUndefined();
    expect(parseTags("Dubious Plan 1080p").voice).toBeUndefined();
  });
  it("makes the labels in order", () => {
    expect(tagLabels(parseTags("Фильм BDRip 1080p AVC | Дубляж"))).toEqual(["1080p", "BDRip", "AVC", "Дубляж"]);
  });
});
