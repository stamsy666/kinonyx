import type { TorApiRelease } from "./api";

export type QualityKey = "2160" | "1080" | "720" | "480";

export const QUALITY_OPTIONS: { key: QualityKey; title: string; hint: string }[] = [
  { key: "2160", title: "4K", hint: "2160p · UHD, HDR" },
  { key: "1080", title: "Full HD", hint: "1080p" },
  { key: "720", title: "HD", hint: "720p" },
  { key: "480", title: "Лёгкое", hint: "480p и ниже — для слабого интернета" },
];

export const qualityLabel = (q: QualityKey) => QUALITY_OPTIONS.find((o) => o.key === q)?.title ?? q;

/** Resolution a release advertises in its title (trackers all put it there), or undefined
 *  when it doesn't say ("BDRip" alone could be anything). */
export function detectQuality(name: string): QualityKey | undefined {
  if (/(^|[^\d])(2160|4320)[pi]?(?!\d)|\b4k\b|\buhd\b/i.test(name)) return "2160";
  if (/(^|[^\d])1080[pi]?(?!\d)|\bfull\s?hd\b/i.test(name)) return "1080";
  if (/(^|[^\d])720[pi]?(?!\d)/i.test(name)) return "720";
  if (/(^|[^\d])(480|576|360)[pi]?(?!\d)|\b(dvdrip|dvd5|dvd9|sdtv|tvrip|satrip|camrip)\b/i.test(name)) return "480";
  return undefined;
}

/** The release to start for a chosen quality: among those of that resolution the one with
 *  the most seeders (a 4K release nobody seeds is worse than none), alive ones first. */
export function pickByQuality(releases: TorApiRelease[], quality: QualityKey): TorApiRelease | undefined {
  const matching = releases.filter((r) => detectQuality(r.name) === quality);
  if (!matching.length) return undefined;
  return [...matching].sort((a, b) => (b.seeds ?? 0) - (a.seeds ?? 0))[0];
}
