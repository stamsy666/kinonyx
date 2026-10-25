import { kpVideos, resolveTrailerUrl, type TrailerQuality, type TrailerStoryboard } from "./api";

/** The trailer picked for the film page's backdrop: one stream to look at, and (YouTube) a separate one to hear. */
export interface BackdropTrailer {
  url: string;
  audioUrl: string | null;
  height: number;
  /** Black bars burnt into the picture, as parts of the frame's height (a trailer of a wide film in a 16:9 frame). */
  bars: { top: number; bottom: number } | null;
}

/** Fewer than this is just a dark edge, not a bar worth cropping. */
const MIN_BARS = 0.04;
/** Never crop to less than this part of the frame, whatever the sheet says. */
const MIN_CONTENT = 0.45;
/** A row is black while its brightest pixel stays under this (0-255). */
const BLACK = 22;
/** A cell is a real picture (not a fade or a black frame) when something in it is brighter than this. */
const ALIVE = 60;

/**
 * Finds the black bars of the video from a sheet of its frames. Only the rows that are black in every
 * real picture of the sheet count, so a dark scene never makes a bar. Null - no bars, or the sheet could
 * not be read (a server without CORS): then the picture is shown as it is.
 */
async function measureBars(sb: TrailerStoryboard | null | undefined): Promise<BackdropTrailer["bars"]> {
  if (!sb) return null;
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => ok(el);
      el.onerror = () => no(new Error("storyboard"));
      el.src = sb.url;
      window.setTimeout(() => no(new Error("storyboard timeout")), 5000);
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    // The sheet is cut by the cell size it really has (the page's numbers can be rounded).
    const cw = Math.floor(canvas.width / sb.cols);
    const ch = Math.floor(canvas.height / sb.rows);
    if (cw < 8 || ch < 8) return null;
    let top = Infinity;
    let bottom = Infinity;
    let alive = 0;
    for (let cy = 0; cy < sb.rows; cy++) {
      for (let cx = 0; cx < sb.cols; cx++) {
        const { data } = ctx.getImageData(cx * cw, cy * ch, cw, ch);
        const rowMax = new Uint8Array(ch);
        let cellMax = 0;
        for (let y = 0; y < ch; y++) {
          let m = 0;
          for (let x = 0; x < cw; x += 2) {
            const i = (y * cw + x) * 4;
            const l = Math.max(data[i], data[i + 1], data[i + 2]);
            if (l > m) m = l;
          }
          rowMax[y] = m;
          if (m > cellMax) cellMax = m;
        }
        if (cellMax < ALIVE) continue;
        alive++;
        let t = 0;
        while (t < ch && rowMax[t] < BLACK) t++;
        let b = 0;
        while (b < ch && rowMax[ch - 1 - b] < BLACK) b++;
        top = Math.min(top, t);
        bottom = Math.min(bottom, b);
      }
    }
    if (alive < 3) return null;
    // One row more than measured: the edge of a bar is blurred by the compression.
    const bars = { top: top === 0 ? 0 : (top + 1) / ch, bottom: bottom === 0 ? 0 : (bottom + 1) / ch };
    if (bars.top + bars.bottom < MIN_BARS || 1 - bars.top - bars.bottom < MIN_CONTENT) return null;
    return bars;
  } catch {
    return null;
  }
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

function pick(qualities: TrailerQuality[], bars: BackdropTrailer["bars"]): BackdropTrailer | null {
  if (qualities.length === 0) return null;
  // Ascending by height: the sharpest one that is still light, else the lightest there is.
  const fit = qualities.filter((q) => q.height <= BACKDROP_MAX_HEIGHT);
  const q = fit.length > 0 ? fit[fit.length - 1] : qualities[0];
  return { url: q.url, audioUrl: q.audioUrl ?? null, height: q.height, bars };
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
        const p = pick(r.qualities, await measureBars(r.storyboard));
        if (p) return p;
      } catch {
        /* blocked or gone — Rutube next */
      }
    }
    try {
      const r = await resolveTrailerUrl("", film);
      return pick(r.qualities, await measureBars(r.storyboard));
    } catch {
      return null;
    }
  })();
  found.set(id, run);
  return run;
}
