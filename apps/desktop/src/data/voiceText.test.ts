import { describe, expect, it } from "vitest";
import { digitsFromWords, looseName } from "./voiceText";

describe("voice text helpers", () => {
  it("turns spoken numbers into digits", () => {
    expect(digitsFromWords("Россия один")).toBe("Россия 1");
    expect(digitsFromWords("канал пять HD")).toBe("канал 5 HD");
    expect(digitsFromWords("Первый канал")).toBe("Первый канал");
  });
  it("compares channel names loosely", () => {
    expect(looseName("Россия-1 HD")).toBe("россия1hd");
    expect(looseName("россия 1")).toBe("россия1");
    expect(looseName("Ёлка")).toBe("елка");
    expect(looseName("Россия-1 HD").includes(looseName(digitsFromWords("Россия один")))).toBe(true);
  });
});
