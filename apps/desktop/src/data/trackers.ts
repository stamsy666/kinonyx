import { isTauri } from "./io";

/** The first two are the ones RuTor's own magnets carry; the rest is what has worked for years. */
const BUILTIN = [
  "udp://opentor.net:6969",
  "http://retracker.local/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://tracker.qu.ax:6969/announce",
  "http://tracker.opentrackr.org:1337/announce",
];

let fetched: string[] = [];

/** What goes into a magnet: the built-in list and the fresh one (Rust `trackers.rs`, refreshed every few days). */
export function currentTrackers(): string[] {
  return [...new Set([...BUILTIN, ...fetched])].slice(0, 32);
}

/** At launch, in the background: a failure just leaves the built-in list. */
export async function refreshTrackers(): Promise<void> {
  if (!isTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const list = await invoke<string[]>("trackers_list");
    if (Array.isArray(list)) fetched = list.filter((t) => typeof t === "string");
  } catch {
    /* the built-in list stays */
  }
}
