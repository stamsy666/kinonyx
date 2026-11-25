import { describe, expect, it, vi } from "vitest";
import { applyRemoteTextEdit } from "./remote";

vi.mock("./io", () => ({ isTauri: false }));

describe("phone keyboard", () => {
  it("inserts text at the caret and leaves the rest of the field intact", () => {
    expect(applyRemoteTextEdit("Война мир", { remove: 0, text: "и ", submit: false }, 6))
      .toEqual({ value: "Война и мир", caret: 8 });
  });

  it("replaces a selected range and deletes a selected range with one backspace", () => {
    expect(applyRemoteTextEdit("1234", { remove: 0, text: "К", submit: false }, 1, 3))
      .toEqual({ value: "1К4", caret: 2 });
    expect(applyRemoteTextEdit("1234", { remove: 1, text: "", submit: false }, 1, 3))
      .toEqual({ value: "14", caret: 1 });
  });

  it("deletes supplementary Unicode characters as one character", () => {
    expect(applyRemoteTextEdit("А🎬", { remove: 1, text: "Б", submit: false }))
      .toEqual({ value: "АБ", caret: 2 });
  });
});
