import { isTauri } from "./io";
import { MOCK } from "./mock";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return MOCK.call<T>(cmd, args);
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

// Same request twice in one session (back to a film, reopening the gallery) shouldn't
// even cross IPC. Failures are dropped so they can be retried. The Rust side has its own
// disk cache on top of this, which survives restarts.
const memo = new Map<string, Promise<unknown>>();
function cached<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const key = cmd + JSON.stringify(args);
  const hit = memo.get(key);
  if (hit) return hit as Promise<T>;
  const p = invoke<T>(cmd, args).catch((e) => {
    memo.delete(key);
    throw e;
  });
  memo.set(key, p);
  return p;
}

// ---------- Kinopoisk ----------

export interface KpGenre {
  genre: string;
}
export interface KpCountry {
  country: string;
}

export interface KpFilm {
  kinopoiskId: number;
  nameRu?: string;
  nameOriginal?: string;
  year?: number;
  filmLength?: number;
  description?: string;
  ratingKinopoisk?: number;
  posterUrl?: string;
  posterUrlPreview?: string;
  coverUrl?: string;
  genres?: KpGenre[];
  countries?: KpCountry[];
  type?: string;
  /** ISO date strings ("2026-11-05") — whichever's set, used to tell an unreleased
   *  title apart from one already out (no "Смотреть"/"Онлайн" until then). */
  premiereRu?: string;
  premiereWorld?: string;
  premiereDigital?: string;
}

export interface KpCollectionItem {
  kinopoiskId: number;
  nameRu?: string;
  nameOriginal?: string;
  year?: string | number;
  posterUrl?: string;
  posterUrlPreview?: string;
  coverUrl?: string | null;
  description?: string;
  ratingKinopoisk?: number;
  genres?: KpGenre[];
  /** Which source this id belongs to — stamped when a film is saved (favorites), so a
   *  later source switch can re-match it by title + year (data/rematch.ts). */
  source?: MetadataSource;
  /** "FILM" / "TV_SERIES" / … — present on search results (used by the search type filter). */
  type?: string;
}

export interface KpCollectionResponse {
  total: number;
  totalPages: number;
  items: KpCollectionItem[];
}

export interface KpImage {
  imageUrl: string;
  previewUrl: string;
}
export interface KpImagesResponse {
  total: number;
  totalPages: number;
  items: KpImage[];
}

export interface KpStaffPerson {
  staffId: number;
  nameRu?: string;
  nameEn?: string;
  posterUrl?: string;
  professionText?: string;
  professionKey?: string;
}

export interface KpPersonFilm {
  filmId: number;
  nameRu?: string;
  nameEn?: string;
  rating?: string;
  year?: string;
  description?: string;
  professionKey?: string;
}
export interface KpPerson {
  personId: number;
  nameRu?: string;
  nameEn?: string;
  posterUrl?: string;
  growth?: string;
  birthday?: string;
  death?: string;
  age?: number;
  birthplace?: string;
  profession?: string;
  facts?: string[];
  films?: KpPersonFilm[];
}

export interface KpVideo {
  url: string;
  name?: string;
  site?: string;
}
export interface KpVideosResponse {
  total: number;
  items: KpVideo[];
}

export interface KpExternalSource {
  url: string;
  name?: string;
  logoUrl?: string;
  platform?: string;
}
export interface KpExternalSourcesResponse {
  total: number;
  items: KpExternalSource[];
}

export const KP_COLLECTIONS = {
  popular: "TOP_POPULAR_MOVIES",
  top250: "TOP_250_MOVIES",
  awaiting: "TOP_AWAIT_FILMS",
} as const;

export function kpFilm(id: number) {
  return cached<KpFilm>("kp_film", { id });
}
export function kpCollection(kind: string, page = 1) {
  return cached<KpCollectionResponse>("kp_collection", { kind, page });
}
export interface KpFilter {
  kind: "FILM" | "TV_SERIES" | "MINI_SERIES" | "ALL";
  genre?: number;
  order?: "NUM_VOTE" | "RATING" | "YEAR";
  ratingFrom?: number;
  yearFrom?: number;
  /** Original language (ISO 639-1, "ja") — TMDB only: its stand-in for the anime genre. */
  language?: string;
}
/** Same item shape as collections (minus description, which the film page then fetches). */
export function kpFilmsFilter(f: KpFilter, page = 1) {
  return cached<KpCollectionResponse>("kp_films_filter", {
    kind: f.kind,
    genre: f.genre,
    order: f.order,
    ratingFrom: f.ratingFrom,
    yearFrom: f.yearFrom,
    language: f.language,
    page,
  });
}

export interface KpGenreDef {
  id: number;
  genre: string;
}
/** Genre id↔name table — resolves a genre chip on a film's page (a name, no id) to the
 *  numeric id `kpFilmsFilter` needs. Static for all practical purposes, cached a month
 *  on the Rust side already; memoised here too since every film page asks for it. */
export function kpGenres() {
  return cached<{ genres: KpGenreDef[] }>("kp_genres", {});
}

/** This endpoint names the film field `filmId`, not `kinopoiskId` like everywhere
 *  else — kept as-is (matches the raw API), adapted where a card gets built from it. */
export interface KpSimilarFilm {
  filmId: number;
  nameRu?: string;
  nameOriginal?: string;
  posterUrl?: string;
  posterUrlPreview?: string;
}
export function kpSimilars(id: number) {
  return cached<{ total: number; items: KpSimilarFilm[] }>("kp_similars", { id });
}

interface KpSearchFilm {
  filmId: number;
  nameRu?: string;
  nameEn?: string;
  year?: string;
  rating?: string;
  description?: string;
  posterUrl?: string;
  posterUrlPreview?: string;
  genres?: KpGenre[];
  type?: string;
}

/** search-by-keyword (v2.1) uses a different shape than v2.2 collections — `filmId`
 *  instead of `kinopoiskId`, rating as a string ("7.9", "88%", "null") — mapped onto
 *  the same card type so the grid doesn't care where a film came from. */
export async function kpSearch(keyword: string): Promise<KpCollectionItem[]> {
  const res = await cached<{ films: KpSearchFilm[] }>("kp_search", { keyword });
  return (res.films ?? []).map((f) => {
    const rating = Number.parseFloat(f.rating ?? "");
    return {
      kinopoiskId: f.filmId,
      nameRu: f.nameRu,
      nameOriginal: f.nameEn,
      year: f.year,
      description: f.description,
      posterUrl: f.posterUrl,
      posterUrlPreview: f.posterUrlPreview,
      ratingKinopoisk: Number.isFinite(rating) && !f.rating?.includes("%") ? rating : undefined,
      genres: f.genres,
      type: f.type,
    };
  });
}
export function kpImages(id: number, imageType = "STILL", page = 1) {
  return cached<KpImagesResponse>("kp_images", { id, imageType, page });
}
export function kpStaff(filmId: number) {
  return cached<KpStaffPerson[]>("kp_staff", { filmId });
}
export function kpPerson(id: number) {
  return cached<KpPerson>("kp_person", { id });
}
export function kpVideos(id: number) {
  return cached<KpVideosResponse>("kp_videos", { id });
}
export function kpExternalSources(id: number) {
  return cached<KpExternalSourcesResponse>("kp_external_sources", { id });
}

// ---------- Trailers ----------

// Not cached: YouTube's resolved stream URLs are signed and expire — reusing a stale
// one would just trade one failure mode for another.
/** One selectable trailer quality — `audioUrl` set when audio is a separate stream. */
export interface TrailerQuality {
  height: number;
  url: string;
  audioUrl?: string | null;
}
/** `url` empty = the source listed no video; Rust then searches Rutube by name + year (it
 *  also does that when a YouTube link fails, so the film's names travel with every call). */
export function resolveTrailerUrl(url: string, film?: { nameRu?: string; nameOriginal?: string; year?: string | number }) {
  return invoke<{ qualities: TrailerQuality[]; defaultIndex: number }>("resolve_trailer_url", {
    url,
    nameRu: film?.nameRu ?? null,
    nameOriginal: film?.nameOriginal ?? null,
    year: film?.year != null ? String(film.year) : null,
  });
}

// ---------- TorAPI ----------

/** Field names vary per tracker (Seeds vs seeds, Magnet vs magnet, ...) — normalized here. */
export interface TorApiRelease {
  id: string;
  provider: string;
  name: string;
  /** Present straight in title-search results for some trackers (RuTor) — lets us skip
   *  the per-release `/api/search/id` round trip entirely. */
  hash?: string;
  /** Direct .torrent download URL — TorrServer can add from it too; last-resort link. */
  torrent?: string;
  size?: string;
  seeds?: number;
  peers?: number;
  type?: string;
}

export interface TorApiReleaseDetail {
  name: string;
  magnet?: string;
  hash?: string;
  torrent?: string;
}

function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] != null) return o[k];
  return undefined;
}
function toNum(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : (v as number);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * `/api/search/title/all` answers with an object keyed by tracker —
 * `{"RuTor":[...], "RuTracker":{"Result":"Server is not available"}, ...}` — while a
 * single-provider search answers with a bare array. The tracker name has to come from
 * that key: the items themselves don't carry it, and `/api/search/id/<provider>` needs it.
 */
function normalizeReleases(raw: unknown, provider: string): TorApiRelease[] {
  const groups: [string, unknown][] = Array.isArray(raw)
    ? [[provider, raw]]
    : raw && typeof raw === "object"
      ? Object.entries(raw as Record<string, unknown>)
      : [];
  return groups
    .flatMap(([key, list]) =>
      (Array.isArray(list) ? list : [])
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .map((r) => ({
          id: String(pick(r, "Id", "id") ?? ""),
          provider: key.toLowerCase(),
          name: String(pick(r, "Name", "Title", "name") ?? ""),
          hash: (pick(r, "Hash", "hash") as string | undefined)?.toLowerCase(),
          torrent: pick(r, "Torrent", "torrent") as string | undefined,
          size: pick(r, "Size", "size") as string | undefined,
          seeds: toNum(pick(r, "Seeds", "seeds")),
          peers: toNum(pick(r, "Peers", "peers")),
          type: pick(r, "Type", "Category", "type") as string | undefined,
        })),
    )
    .filter((r) => r.id && r.name);
}

export async function torApiSearchTitle(query: string, year?: number, provider = "all"): Promise<TorApiRelease[]> {
  const raw = await invoke<unknown>("torapi_search_title", { query, year, page: 0, provider });
  return normalizeReleases(raw, provider);
}

/** `/api/search/id/<provider>` answers with a one-element ARRAY, not an object — reading
 *  `Magnet` off the array itself is what produced "у раздачи нет magnet-ссылки" for
 *  every NoNameClub release (their title-search results carry no Hash, so they all went
 *  through here). */
export async function torApiSearchId(provider: string, id: string): Promise<TorApiReleaseDetail> {
  const raw = await invoke<unknown>("torapi_search_id", { provider, id });
  const item = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
  if (!item || typeof item !== "object") return { name: "" };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return {
    name: str(pick(item, "Name", "name")) ?? "",
    magnet: str(pick(item, "Magnet", "magnet")),
    hash: str(pick(item, "Hash", "hash"))?.toLowerCase(),
    torrent: str(pick(item, "Torrent", "torrent")),
  };
}

// ---------- Torrserve ----------

export function torrserveHealth() {
  return invoke<boolean>("torrserve_health");
}
export function tsAddMagnet(magnet: string) {
  return invoke<{ hash?: string }>("ts_add_magnet", { magnet });
}
export function tsGetTorrent(hash: string) {
  return invoke<Record<string, unknown>>("ts_get_torrent", { hash });
}
export function tsStreamUrl(hash: string, fileIndex: number, fileName?: string) {
  return invoke<string>("ts_stream_url", { hash, fileIndex, fileName });
}

interface TsFileStat {
  id: number;
  path: string;
  length?: number;
}

const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|mov|ts|m2ts|webm|wmv|flv|mpg|mpeg)$/i;
const METADATA_TIMEOUT_MS = 45_000;
const METADATA_POLL_MS = 1_000;

/**
 * Public trackers added to every link. RuTor results were added as a bare info-hash
 * (it's right there in the search results, saving a request) — but a bare hash can only
 * find peers through DHT, which is slow to warm up and misses most of a small swarm.
 * The first two are the ones RuTor's own magnets carry.
 */
const TRACKERS = [
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

/** hash or magnet → magnet carrying our tracker list. .torrent URLs pass through as-is. */
export function withTrackers(link: string): string {
  let magnet: string;
  if (/^[0-9a-f]{40}$/i.test(link)) magnet = `magnet:?xt=urn:btih:${link.toLowerCase()}`;
  else if (link.startsWith("magnet:")) magnet = link;
  else return link;
  const present = new Set(
    [...magnet.matchAll(/[?&]tr=([^&]*)/g)].map((m) => {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }),
  );
  const extra = TRACKERS.filter((t) => !present.has(t)).map((t) => `&tr=${encodeURIComponent(t)}`);
  return magnet + extra.join("");
}

export interface TorrentFile {
  id: number;
  path: string;
  name: string;
  length: number;
}

/**
 * Adds the torrent and waits for its file list. TorrServer only knows the files once it
 * has fetched the metadata from peers, which `add` doesn't wait for — so poll `get` until
 * `file_stats` shows up.
 */
export async function openTorrent(link: string, signal?: { cancelled: boolean }): Promise<{ hash: string; files: TorrentFile[] }> {
  const added = await tsAddMagnet(withTrackers(link));
  const hash = added.hash;
  if (!hash) throw new Error("TorrServer не вернул hash раздачи");

  const deadline = Date.now() + METADATA_TIMEOUT_MS;
  let stats: TsFileStat[] = [];
  while (Date.now() < deadline) {
    if (signal?.cancelled) throw new Error("cancelled");
    const torrent = await tsGetTorrent(hash);
    stats = (torrent.file_stats as TsFileStat[] | undefined) ?? [];
    if (stats.length) break;
    await new Promise((r) => setTimeout(r, METADATA_POLL_MS));
  }
  if (!stats.length) throw new Error("Не удалось получить список файлов — у раздачи нет активных сидов");
  const files = stats.map((f) => ({ id: f.id, path: f.path, name: f.path.split("/").pop() ?? f.path, length: f.length ?? 0 }));
  return { hash, files };
}

/**
 * Which file to play. A film release carries one big video plus samples, extras and
 * subtitles — play the big one without asking. A season pack (or a film collection) has
 * several videos of similar size — those are the viewer's choice, listed in natural
 * order ("E2" before "E10").
 */
export function playableFiles(files: TorrentFile[]): { auto?: TorrentFile; choices: TorrentFile[] } {
  const videos = files.filter((f) => VIDEO_EXT.test(f.path));
  const pool = videos.length ? videos : files;
  const largest = pool.reduce((a, b) => (b.length > a.length ? b : a));
  const main = pool.filter((f) => f.length >= largest.length * 0.3);
  if (main.length <= 1) return { auto: largest, choices: [] };
  return { choices: [...main].sort((a, b) => a.path.localeCompare(b.path, "ru", { numeric: true })) };
}

export function streamUrlFor(hash: string, file: TorrentFile) {
  return tsStreamUrl(hash, file.id, file.name);
}

export interface SwarmStats {
  /** bytes/s from peers right now */
  downloadSpeed: number;
  activePeers: number;
  seeders: number;
  totalPeers: number;
}

/** Live swarm numbers for the stats overlay. TorrServer omits `download_speed` when it's 0. */
export async function torrentSwarmStats(hash: string): Promise<SwarmStats> {
  const t = await tsGetTorrent(hash);
  const n = (k: string) => (typeof t[k] === "number" ? (t[k] as number) : 0);
  return {
    downloadSpeed: n("download_speed"),
    activePeers: n("active_peers"),
    seeders: n("connected_seeders"),
    totalPeers: n("total_peers"),
  };
}

/** "5.95 GB" / "700 MB" / "1,2 ГБ" → bytes. */
export function parseSize(size?: string): number | undefined {
  const m = size?.replace(",", ".").match(/([\d.]+)\s*([KMGT]i?B|[КМГТ]Б)/i);
  if (!m) return undefined;
  const unit = m[2].toUpperCase()[0];
  const pow = { K: 1, К: 1, M: 2, М: 2, G: 3, Г: 3, T: 4, Т: 4 }[unit] ?? 0;
  return Number.parseFloat(m[1]) * 1024 ** pow;
}

// ---------- Config ----------

export type MetadataSource = "kinopoisk" | "tmdb";
/** Whose signed-in YouTube session yt-dlp may borrow for trailers ("" = nobody, default). */
export type YoutubeCookiesBrowser = "" | "chrome" | "edge" | "firefox";

export interface ConfigStatus {
  /** e.g. "a1b2…d4e5"; null when no key is set. The full key never reaches the webview. */
  kinopoisk_key_masked: string | null;
  tmdb_key_masked: string | null;
  metadata_source: MetadataSource;
  youtube_cookies_browser: YoutubeCookiesBrowser;
  torapi_base_url: string;
  setup_done: boolean;
  /** Discord status can work (an application id was entered or built in). */
  discord_ready: boolean;
  discord_app_id: string;
  torrserve_port: number;
}
export function configStatus() {
  return invoke<ConfigStatus>("config_status");
}
export function setTorApiBaseUrl(url: string) {
  return invoke<void>("set_torapi_base_url", { url });
}
export async function setKinopoiskApiKey(key: string) {
  await invoke<void>("set_kinopoisk_api_key", { key });
  // Anything that failed on the old/missing key must be refetched with the new one.
  memo.clear();
}
export async function setTmdbApiKey(key: string) {
  await invoke<void>("set_tmdb_api_key", { key });
  memo.clear();
}
export function setYoutubeCookiesBrowser(browser: YoutubeCookiesBrowser) {
  return invoke<void>("set_youtube_cookies_browser", { browser });
}
export function setDiscordAppId(id: string) {
  return invoke<void>("set_discord_app_id", { id });
}
export function setSetupDone(done: boolean) {
  return invoke<void>("set_setup_done", { done });
}
/** Asks the source itself whether `key` works (one cheap request); rejects with a message
 *  ready to show — wrong key, rate limit, or "needs VPN". Nothing is saved. */
export function checkSourceKey(source: MetadataSource, key: string) {
  return invoke<void>("check_source_key", { source, key });
}
export interface DiagnosticCheck {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  hint: string | null;
}
export function runDiagnostics() {
  return invoke<DiagnosticCheck[]>("run_diagnostics");
}
/** Switches which backend every `kp_*` command hits (see kinopoisk.rs/tmdb.rs) — clears the
 *  in-memory cache so nothing from the old source lingers on screen after switching. */
export async function setMetadataSource(source: MetadataSource) {
  await invoke<void>("set_metadata_source", { source });
  memo.clear();
}
