/** Shared image warm-up for the still viewers: remembers which URLs are already downloaded
 *  (so a slide can paint the full frame at once instead of flashing its blurry preview first)
 *  and keeps the <img> objects of preloaded ones alive so the browser doesn't drop them. */

const done = new Set<string>();
const inflight = new Map<string, Promise<void>>();
const keep = new Map<string, HTMLImageElement>();

export const isImageLoaded = (url: string | undefined): boolean => !!url && done.has(url);

export function markImageLoaded(url: string) {
  done.add(url);
}

/** Download `url` into the cache (once). Never rejects — a failed warm-up just means the
 *  viewer loads it the normal way when the frame is reached. */
export function preloadImage(url: string | undefined): Promise<void> {
  if (!url || done.has(url)) return Promise.resolve();
  const pending = inflight.get(url);
  if (pending) return pending;
  const p = new Promise<void>((resolve) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => {
      done.add(url);
      keep.set(url, im);
      inflight.delete(url);
      resolve();
    };
    im.onerror = () => {
      inflight.delete(url);
      resolve();
    };
    im.src = url;
  });
  inflight.set(url, p);
  return p;
}

/** Indexes ordered by distance from `index`, nearest first, next-before-previous
 *  (flipping forward is by far the commoner direction), wrapping around the ends. */
export function proximityOrder(index: number, count: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= Math.floor(count / 2); d++) {
    out.push((index + d) % count);
    const back = (index - d + count) % count;
    if (back !== out[out.length - 1]) out.push(back);
  }
  if (count % 2 === 0 && count > 1) {
    const opposite = (index + count / 2) % count;
    if (!out.includes(opposite)) out.push(opposite);
  }
  return out.filter((i) => i !== index);
}
