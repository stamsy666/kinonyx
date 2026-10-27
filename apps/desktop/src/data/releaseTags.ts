/** What a release's name says about it: picture, HDR, codec, the kind of voice-over and the studio. The tracker's title is
 *  free text ("Дюна / Dune (2021) BDRemux 2160p HEVC HDR10 | Dub, MVO | LostFilm"), so this is a set of recognisers,
 *  each one only for what is said unmistakably. */
export interface ReleaseTags {
  quality?: "4K" | "1080p" | "720p" | "SD";
  /** Where the picture comes from. */
  source?: "Remux" | "BDRip" | "WEB-DL" | "TV";
  hdr?: "Dolby Vision" | "HDR10+" | "HDR";
  codec?: "HEVC" | "AV1" | "AVC";
  voice?: "Дубляж" | "Многоголосая" | "Двухголосая" | "Одноголосая" | "Оригинал";
  studio?: string;
}

// `\b` knows no Cyrillic: words are fenced by "not a letter or a digit".
const w = (alt: string) => new RegExp(String.raw`(^|[^\p{L}\p{N}])(${alt})($|[^\p{L}\p{N}])`, "iu");

const STUDIOS = [
  "LostFilm",
  "NewStudio",
  "Кубик в Кубе",
  "TVShows",
  "Jaskier",
  "HDRezka Studio",
  "Пифагор",
  "Сыендук",
  "ColdFilm",
  "AlexFilm",
  "BaibaKo",
  "Amedia",
  "Кураж-Бамбей",
  "Anilibria",
  "AniDub",
  "SHIZA",
];

export function parseTags(name: string): ReleaseTags {
  const t: ReleaseTags = {};
  if (w("2160p|4K|UHD").test(name)) t.quality = "4K";
  else if (w("1080[pi]").test(name)) t.quality = "1080p";
  else if (w("720p").test(name)) t.quality = "720p";
  else if (w("480p|DVDRip|SATRip|TVRip|CAMRip|TS|HDTV").test(name)) t.quality = "SD";

  if (w("remux|BDRemux").test(name)) t.source = "Remux";
  else if (w("BDRip|BluRay|Blu-Ray|BRRip").test(name)) t.source = "BDRip";
  else if (w("WEB-DL|WEBRip|WEB-DLRip|WEBDL").test(name)) t.source = "WEB-DL";
  else if (w("HDTV|TVRip|SATRip").test(name)) t.source = "TV";

  if (w("Dolby ?Vision|DV|DoVi").test(name)) t.hdr = "Dolby Vision";
  else if (/HDR10\+/i.test(name)) t.hdr = "HDR10+";
  else if (w("HDR10|HDR").test(name)) t.hdr = "HDR";

  if (w("HEVC|H\\.?265|x265").test(name)) t.codec = "HEVC";
  else if (w("AV1").test(name)) t.codec = "AV1";
  else if (w("AVC|H\\.?264|x264").test(name)) t.codec = "AVC";

  // The best of what is named wins: a release with a dub and a multi-voice track is "Дубляж".
  if (/(^|[^\p{L}\p{N}])(dub($|[^\p{L}])|дубл)/iu.test(name)) t.voice = "Дубляж";
  else if (w("MVO|Многоголос\\p{L}*|Mvo").test(name)) t.voice = "Многоголосая";
  else if (w("DVO|Двухголос\\p{L}*").test(name)) t.voice = "Двухголосая";
  else if (w("AVO|VO|Одноголос\\p{L}*").test(name)) t.voice = "Одноголосая";
  else if (w("Original|Оригинал|Eng|ENG").test(name)) t.voice = "Оригинал";

  const studio = STUDIOS.find((s) => name.toLowerCase().includes(s.toLowerCase()));
  if (studio) t.studio = studio;
  return t;
}

/** The short labels shown on a release row. */
export function tagLabels(t: ReleaseTags): string[] {
  return [t.quality, t.source, t.hdr, t.codec, t.voice, t.studio].filter((x): x is string => !!x);
}
