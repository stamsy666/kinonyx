import { kpVideos, resolveTrailerUrl, type TrailerQuality } from "./api";

/** The trailer picked for the film page's backdrop: one stream to look at, and (YouTube) a separate one to hear. */
export interface BackdropTrailer {
  /** Every quality there is (ascending by height); a separate `audioUrl` where the sound is a stream of its own. */
  qualities: TrailerQuality[];
  /** Shown as the backdrop: the sharpest one that is still light. */
  index: number;
  /** Shown when the trailer is watched on purpose: the sharpest up to 1080p. */
  fullIndex: number;
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

/** Makes the backdrop's trailer of what the resolver returned. */
export function makeTrailer(r: Awaited<ReturnType<typeof resolveTrailerUrl>>): BackdropTrailer | null {
  if (r.qualities.length === 0) return null;
  // Ascending by height: the sharpest one that is still light, else the lightest there is.
  let index = 0;
  r.qualities.forEach((q, i) => {
    if (q.height <= BACKDROP_MAX_HEIGHT) index = i;
  });
  const fullIndex = Math.min(Math.max(r.defaultIndex, 0), r.qualities.length - 1);
  return { qualities: r.qualities, index, fullIndex };
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
        const p = makeTrailer(r);
        if (p) return p;
      } catch {
        /* blocked or gone — Rutube next */
      }
    }
    try {
      const r = await resolveTrailerUrl("", film);
      return makeTrailer(r);
    } catch {
      return null;
    }
  })();
  found.set(id, run);
  return run;
}
