import { kpVideos, resolveTrailerUrl, type TrailerQuality } from "./api";

/** The trailer picked for the film page's backdrop: one stream to look at, and (YouTube) a separate one to hear. */
export interface BackdropTrailer {
  url: string;
  audioUrl: string | null;
  height: number;
}

export function isYoutubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

/** A backdrop does not need more than this: it is cheap to decode and sharp enough behind the text. */
const BACKDROP_MAX_HEIGHT = 720;

function pick(qualities: TrailerQuality[]): BackdropTrailer | null {
  if (qualities.length === 0) return null;
  // Ascending by height: the sharpest one that is still light, else the lightest there is.
  const fit = qualities.filter((q) => q.height <= BACKDROP_MAX_HEIGHT);
  const q = fit.length > 0 ? fit[fit.length - 1] : qualities[0];
  return { url: q.url, audioUrl: q.audioUrl ?? null, height: q.height };
}

// One try per film per session, failures included: every try is a yt-dlp run against YouTube, and
// repeating a refused one only makes the refusing (the "not a bot" block sits on the IP) last longer.
const found = new Map<number, Promise<BackdropTrailer | null>>();

/**
 * The first YouTube trailer of the film, else the one Rutube has by name and year. Never rejects —
 * no trailer simply means the backdrop stays what it was (the screenshots).
 */
export function loadBackdropTrailer(
  id: number,
  film: { nameRu?: string; nameOriginal?: string; year?: string | number },
): Promise<BackdropTrailer | null> {
  const hit = found.get(id);
  if (hit) return hit;
  const run = (async () => {
    let youtube: string | undefined;
    try {
      const videos = await kpVideos(id);
      youtube = (videos.items ?? []).map((v) => v.url).find((u) => u && isYoutubeUrl(u));
    } catch {
      /* the list is optional — Rutube is still tried */
    }
    if (youtube) {
      try {
        const r = await resolveTrailerUrl(youtube, film);
        const p = pick(r.qualities);
        if (p) return p;
      } catch {
        /* blocked or gone — Rutube next */
      }
    }
    try {
      const r = await resolveTrailerUrl("", film);
      return pick(r.qualities);
    } catch {
      return null;
    }
  })();
  found.set(id, run);
  return run;
}
