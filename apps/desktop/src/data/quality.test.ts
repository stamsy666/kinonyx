import { describe, expect, it } from "vitest";
import { detectQuality } from "./quality";

describe("detectQuality", () => {
  it("reads the resolution tracker titles carry", () => {
    expect(detectQuality("Дюна / Dune (2021) UHD BDRip 2160p | 4K | HDR")).toBe("2160");
    expect(detectQuality("Дюна (2021) WEB-DL 1080p")).toBe("1080");
    expect(detectQuality("Дюна (2021) HEVC 720p")).toBe("720");
    expect(detectQuality("Дюна (2021) DVDRip")).toBe("480");
    expect(detectQuality("Дюна (2021) BDRip")).toBeUndefined();
  });

  it("doesn't take numbers inside other numbers for a resolution", () => {
    expect(detectQuality("Фильм 21080 серия")).toBeUndefined();
  });
});
