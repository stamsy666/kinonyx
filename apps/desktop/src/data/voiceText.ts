/** Helpers for turning recognised speech into something a name search can use. */

const NUMBER_WORDS: Record<string, string> = {
  ноль: "0", один: "1", одна: "1", два: "2", две: "2", три: "3", четыре: "4", пять: "5",
  шесть: "6", семь: "7", восемь: "8", девять: "9", десять: "10",
};

/** "Россия один" → "Россия 1" — Whisper writes small numbers as words, channel names use digits. */
export function digitsFromWords(text: string): string {
  return text
    .split(/\s+/)
    .map((w) => NUMBER_WORDS[w.toLowerCase().replace(/[^а-яё]/g, "")] ?? w)
    .join(" ");
}

/** Comparison form of a name: lower case, ё = е, no spaces/hyphens/punctuation ("Россия-1" ≈ "россия 1"). */
export function looseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, "");
}
