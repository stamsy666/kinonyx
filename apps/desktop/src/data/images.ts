import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "./io";

const PROXIED = /^https:\/\/(kinopoiskapiunofficial\.tech|st\.kp\.yandex\.net|avatars\.mds\.yandex\.net|image\.tmdb\.org)\//;

/** Kinopoisk image → the Rust `kpimg` proxy (pooled connections + disk cache, see
 *  images.rs). In the browser preview there is no proxy, so the URL is used as-is. */
export function img(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (!isTauri || !PROXIED.test(url)) return url;
  return convertFileSrc(url, "kpimg");
}

/** Stills come as `/orig` — measured ~660 KB and ~4 s each, which made flipping through
 *  them look broken. `/1920x` is the largest resized variant (~280 KB). */
export function stillLarge(url: string): string {
  return url.replace(/\/orig$/, "/1920x");
}
