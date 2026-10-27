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
  /** The seasons a release of a series holds (a pack of three seasons: [1, 2, 3]); none for a film. */
  seasons?: number[];
  /** The episodes of it, "1–8" (with "из 12" in `of` when the title says how many there are). */
  episodes?: string;
  of?: number;
}

// `\b` knows no Cyrillic: words are fenced by "not a letter or a digit".
const w = (alt: string) => new RegExp(String.raw`(^|[^\p{L}\p{N}])(${alt})($|[^\p{L}\p{N}])`, "iu");

/** A range or one number from the title's own words about seasons and episodes. */
function parseSeasons(name: string): number[] | undefined {
  const range =
    name.match(/\[S(\d{1,2})\s*[-–]\s*S?(\d{1,2})\]/i) ||
    name.match(/(?:сезон[ыа]?|seasons?)[:\s]*(\d{1,2})\s*[-–]\s*(\d{1,2})/i) ||
    name.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(?:сезон|season)/i) ||
    name.match(/\bS(\d{1,2})\s*[-–]\s*S(\d{1,2})\b/i);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (from >= 1 && to >= from && to - from < 40) return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }
  const one =
    name.match(/(\d{1,2})\s*(?:сезон|season)/i) || name.match(/(?:сезон|season)[:\s]*(\d{1,2})/i) || name.match(/\bS(\d{1,2})(?:E\d|\b)/i) || name.match(/\b(\d{1,2})x\d{1,2}\b/i);
  return one && Number(one[1]) >= 1 ? [Number(one[1])] : undefined;
}

function parseEpisodes(name: string): { episodes?: string; of?: number } {
  const ranged =
    name.match(/сери[яи][:\s]*(\d{1,3})\s*[-–]\s*(\d{1,3})(?:\s*из\s*(\d{1,3}))?/i) ||
    name.match(/\[(\d{1,3})\s*[-–]\s*(\d{1,3})\s*из\s*(\d{1,3})\]/i) ||
    name.match(/\(?(\d{1,3})\s*[-–]\s*(\d{1,3})\s*из\s*(\d{1,3})\)?/i) ||
    name.match(/\bE(\d{1,3})\s*[-–]\s*E?(\d{1,3})\b/i);
  if (ranged) return { episodes: `${Number(ranged[1])}–${Number(ranged[2])}`, of: ranged[3] ? Number(ranged[3]) : undefined };
  const single = name.match(/сери[яи][:\s]*(\d{1,3})\b/i) || name.match(/\b(\d{1,3})\s*сери[яи]\b/i) || name.match(/\bS\d{1,2}E(\d{1,3})\b/i);
  return single ? { episodes: String(Number(single[1])) } : {};
}

const STUDIOS = [
  "Red Head Sound",
  "Gears Media",
  "HDrezka",
  "Rezka",
  "Sunshine Studio",
  "TVShows",
  "Baibako",
  "NovaFilm",
  "Fox Crime",
  "Любимое кино",
  "Ultradox",
  "Нота",
  "Октопус",
  "Невафильм",
  "Мосфильм",
  "Союзмультфильм",
  "Постмодерн",
  "Ленфильм",
  "Videofilm",
  "Hamster Studio",
  "CPIG",
  "Kerob",
  "GoldTeam",
  "Alexfilm",
  "Rus Dub",
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

  const seasons = parseSeasons(name);
  if (seasons) t.seasons = seasons;
  const { episodes, of } = parseEpisodes(name);
  if (episodes) {
    t.episodes = episodes;
    if (of) t.of = of;
  }

  const studio = STUDIOS.find((s) => name.toLowerCase().includes(s.toLowerCase()));
  if (studio) t.studio = studio;
  return t;
}

/** The short labels shown on a release row. */
export function tagLabels(t: ReleaseTags): string[] {
  return [seasonLabel(t), episodesLabel(t), t.quality, t.source, t.hdr, t.codec, t.voice, t.studio].filter((x): x is string => !!x);
}

/** "Сезон 2" / "Сезоны 1–3". */
export function seasonLabel(t: ReleaseTags): string | undefined {
  if (!t.seasons?.length) return undefined;
  return t.seasons.length === 1 ? `Сезон ${t.seasons[0]}` : `Сезоны ${t.seasons[0]}–${t.seasons[t.seasons.length - 1]}`;
}

/** "Серии 1–8 из 12" / "Серия 5". */
export function episodesLabel(t: ReleaseTags): string | undefined {
  if (!t.episodes) return undefined;
  return `${t.episodes.includes("–") ? "Серии" : "Серия"} ${t.episodes}${t.of ? ` из ${t.of}` : ""}`;
}
