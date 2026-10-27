import type { TorApiRelease } from "./api";

const URL_KEY = "kinonyx.jacredUrl";
const KEY_KEY = "kinonyx.jacredKey";

/** An optional second source of releases: a JacRed server (an aggregator of torrent trackers) at the address from Settings. */
/** Built in: whoever has never touched the field (a fresh install, or an update of an older version) gets this server.
 *  An emptied field is a choice (the source is off) and stays empty. */
export const DEFAULT_JACRED_URL = "http://jac.red";

export function getJacredUrl(): string {
  try {
    return localStorage.getItem(URL_KEY) ?? DEFAULT_JACRED_URL;
  } catch {
    return DEFAULT_JACRED_URL;
  }
}
export function getJacredKey(): string {
  try {
    return localStorage.getItem(KEY_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setJacred(url: string, key: string): void {
  try {
    localStorage.setItem(URL_KEY, url.trim());
    localStorage.setItem(KEY_KEY, key.trim());
  } catch {
    /* won't survive a restart */
  }
}
export const jacredEnabled = () => /^https?:\/\//i.test(getJacredUrl().trim());

interface JacredItem {
  tracker?: string;
  title?: string;
  sizeName?: string;
  size?: number;
  sid?: number;
  pir?: number;
  magnet?: string;
  Tracker?: string;
  Title?: string;
  Size?: number;
  Seeders?: number;
  Peers?: number;
  MagnetUri?: string;
}

const fmtSize = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${Math.round(n / 1024 ** 2)} MB`);

/** The info-hash of a magnet (or of a bare hash) — what two sources' copies of one release have in common. */
export function btihOf(link: string | undefined): string | undefined {
  if (!link) return undefined;
  const m = link.match(/btih:([0-9a-z]{32,40})/i) ?? link.match(/^([0-9a-f]{40})$/i);
  return m?.[1].toLowerCase();
}

/** A JacRed answer (an array of its torrents, or a Jackett-style `{Results}`) as releases the picker knows. */
export function normalizeJacred(raw: unknown): TorApiRelease[] {
  const list: JacredItem[] = Array.isArray(raw) ? raw : Array.isArray((raw as { Results?: unknown })?.Results) ? (raw as { Results: JacredItem[] }).Results : [];
  const out: TorApiRelease[] = [];
  for (const i of list) {
    const magnet = i.magnet ?? i.MagnetUri;
    if (!magnet?.startsWith("magnet:")) continue;
    const name = (i.title ?? i.Title ?? "").trim();
    if (!name) continue;
    const bytes = i.size ?? i.Size;
    out.push({
      id: btihOf(magnet) ?? magnet,
      provider: `JacRed · ${i.tracker ?? i.Tracker ?? "?"}`,
      name,
      hash: magnet,
      size: i.sizeName ?? (bytes ? fmtSize(bytes) : undefined),
      seeds: i.sid ?? i.Seeders ?? 0,
      peers: i.pir ?? i.Peers ?? 0,
    });
  }
  return out;
}

export async function jacredSearch(query: string): Promise<TorApiRelease[]> {
  // (io.ts reads `window` when it loads — the tests of this file run without one.)
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window) || !jacredEnabled()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<unknown>("jacred_search", { base: getJacredUrl(), key: getJacredKey() || null, query });
  return normalizeJacred(raw);
}

/** Two lists of releases as one: the same release (the same info-hash) from both sources stays once, with the better numbers. */
export function mergeReleases(a: TorApiRelease[], b: TorApiRelease[]): TorApiRelease[] {
  const byHash = new Map<string, TorApiRelease>();
  const rest: TorApiRelease[] = [];
  for (const r of [...a, ...b]) {
    const h = btihOf(r.hash);
    if (!h) {
      rest.push(r);
      continue;
    }
    const have = byHash.get(h);
    if (!have || (r.seeds ?? 0) > (have.seeds ?? 0)) byHash.set(h, have ? { ...r, hash: have.hash ?? r.hash } : r);
  }
  return [...byHash.values(), ...rest];
}
