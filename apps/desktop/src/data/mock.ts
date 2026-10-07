/**
 * Browser dev-preview stand-in for the Rust commands (kinopoisk/torapi/torrserve all
 * require Tauri — no CORS-friendly browser path, that's the point of routing them through
 * Rust, see CLAUDE.md). Lets every screen be built/inspected in the Browser pane without a
 * compiled Tauri window; swapped out automatically for real `invoke` calls under `isTauri`.
 */

const POSTER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='450'><rect width='100%' height='100%' fill='#1b2230'/><text x='50%' y='50%' fill='#4a5568' font-size='20' text-anchor='middle' font-family='sans-serif'>KINONYX</text></svg>`,
  );

function film(id: number, name: string, year: number, rating: number, desc: string) {
  return {
    kinopoiskId: id,
    nameRu: name,
    nameOriginal: name,
    year,
    filmLength: 118,
    description: desc,
    ratingKinopoisk: rating,
    posterUrl: POSTER,
    posterUrlPreview: POSTER,
    coverUrl: POSTER,
    genres: [{ genre: "фантастика" }, { genre: "драма" }],
    countries: [{ country: "США" }],
    type: "FILM",
  };
}

const FILMS = [
  film(1, "Маяк над бездной", 2024, 8.1, "Смотритель одинокого маяка сталкивается с тем, чего не может объяснить."),
  film(2, "Последний рейс", 2023, 7.4, "Экипаж грузового судна получает сигнал, которого не должно существовать."),
  film(3, "Стеклянный город", 2022, 7.9, "Архитектор возвращается в город, который сам когда-то спроектировал."),
  film(4, "Тихий океан", 2025, 8.6, "История о том, как далеко можно уплыть от самого себя."),
  film(5, "Северный свет", 2021, 7.0, "Экспедиция теряет связь с базой на десятый день полярной ночи."),
  film(6, "Красная нить", 2024, 8.3, "Детектив в отставке распутывает дело, которое сам когда-то закрыл."),
  { ...film(7, "Тень Немезиды", 2027, 0, "Продолжение культовой саги — детали пока держатся в тайне."), ratingKinopoisk: undefined, premiereRu: "2027-03-12" },
];

// Same shape as the real `/api/search/title/all`: keyed by tracker, unreachable trackers
// answer with a `Result` object instead of a list (seen live from the Vercel deployment).
const releases = (title: string) => ({
  RuTracker: { Result: "Server is not available" },
  RuTor: [
    { Id: "1098254", Name: `${title} / 2024 / WEB-DL 1080p`, Hash: "F99EDB3D16451A80283463EDA2A9E8EA1FCCACC9", Size: "5.95 GB", Seeds: "142", Peers: "8" },
    { Id: "1085666", Name: `${title} / 2024 / UHD BDRip 2160p | 4K | HDR | Dolby Vision`, Hash: "AE0CF422FA0BC9669AD605EA564999A8FBE5AA4B", Size: "18.3 GB", Seeds: "63", Peers: "4" },
    { Id: "1084242", Name: `${title} / 2024 / HEVC 720p`, Hash: "8241BA8D49ADB5C5D1B2F260944976C78DBAEE05", Size: "2.1 GB", Seeds: "301", Peers: "21" },
  ],
  // NoNameClub title results carry no Hash — they go through /api/search/id.
  NoNameClub: [{ Id: "1861062", Name: `${title} (2024) BDRip 1080p`, Size: "9.4 GB", Seeds: "88", Peers: "3", Torrent: "https://nnmclub.to/forum/download.php?id=1411580" }],
});

// `?setup` in the preview URL shows the first-run wizard (fresh install: no key, not done).
const previewFreshInstall = typeof location !== "undefined" && location.search.includes("setup");
let mockKey: string | null = previewFreshInstall ? null : "a1b2…d4e5";
let mockTmdbKey: string | null = null;
let mockSource: "kinopoisk" | "tmdb" = "kinopoisk";
let mockCookies = "";
let mockTorApi = "https://ohnofreefilms.vercel.app";
let mockSetupDone = !previewFreshInstall;

export const MOCK = {
  async call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    await new Promise((r) => setTimeout(r, 120));
    switch (cmd) {
      case "config_status":
        return {
          kinopoisk_key_masked: mockKey,
          tmdb_key_masked: mockTmdbKey,
          metadata_source: mockSource,
          youtube_cookies_browser: mockCookies,
          torapi_base_url: mockTorApi,
          setup_done: mockSetupDone,
          torrserve_port: 8090,
        } as T;
      case "set_kinopoisk_api_key": {
        const k = String(args?.key ?? "").trim();
        if (!k) throw new Error("Ключ пустой");
        mockKey = k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "•".repeat(k.length);
        return undefined as T;
      }
      case "set_tmdb_api_key": {
        const k = String(args?.key ?? "").trim();
        if (!k) throw new Error("Ключ пустой");
        mockTmdbKey = k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : "•".repeat(k.length);
        return undefined as T;
      }
      case "set_setup_done":
        mockSetupDone = Boolean(args?.done);
        return undefined as T;
      case "check_source_key": {
        // Preview only: any key ending in "bad" is rejected so the error path can be seen.
        const k = String(args?.key ?? "").trim();
        if (!k) throw new Error("Ключ пустой");
        if (k.endsWith("bad")) throw new Error("Ключ не подошёл — проверьте, что скопировали его целиком");
        return undefined as T;
      }
      case "run_diagnostics":
        return [
          { id: "torrserve", label: "TorrServer", status: "ok", detail: "запущен", hint: null },
          { id: "kp_key", label: "Ключ Кинопоиска", status: "ok", detail: "ключ принят", hint: null },
          { id: "tmdb_key", label: "Ключ TMDB", status: "warn", detail: "ключ не задан", hint: "Получите ключ на themoviedb.org/settings/api (нужен только для источника TMDB)" },
          { id: "youtube", label: "YouTube (трейлеры)", status: "fail", detail: "www.youtube.com не отвечает — возможно, нужен VPN или нет интернета", hint: "Включите VPN — либо трейлер найдётся на Rutube сам" },
          { id: "tmdb_host", label: "TMDB (api.themoviedb.org)", status: "ok", detail: "доступен (HTTP 404)", hint: null },
          { id: "torapi", label: "TorAPI (поиск раздач)", status: "ok", detail: "доступен (HTTP 200)", hint: null },
          { id: "ytdlp", label: "yt-dlp (трейлеры)", status: "ok", detail: "найден", hint: null },
          { id: "libmpv", label: "libmpv (плеер)", status: "ok", detail: "найден", hint: null },
          { id: "js_runtime", label: "JS-движок для трейлеров", status: "ok", detail: "QuickJS из комплекта", hint: null },
        ] as T;
      case "set_youtube_cookies_browser":
        mockCookies = String(args?.browser ?? "");
        return undefined as T;
      case "set_metadata_source": {
        const src = String(args?.source ?? "");
        if (src !== "kinopoisk" && src !== "tmdb") throw new Error("Неизвестный источник");
        mockSource = src;
        return undefined as T;
      }
      case "set_torapi_base_url": {
        const u = String(args?.url ?? "").trim();
        if (!/^https?:\/\//.test(u)) throw new Error("Ссылка должна начинаться с http:// или https://");
        mockTorApi = u.replace(/\/+$/, "");
        return undefined as T;
      }
      case "kp_collection":
        return { total: FILMS.length, totalPages: 1, items: FILMS } as T;
      case "kp_films_filter":
        // Real filter results carry no description.
        return { total: FILMS.length, totalPages: 1, items: FILMS.map(({ description: _d, ...f }) => f) } as T;
      case "kp_search": {
        const q = String(args?.keyword ?? "").toLowerCase();
        const films = FILMS.filter((f) => f.nameRu.toLowerCase().includes(q)).map((f) => ({
          filmId: f.kinopoiskId,
          nameRu: f.nameRu,
          nameEn: f.nameOriginal,
          year: String(f.year),
          rating: String(f.ratingKinopoisk),
          posterUrl: f.posterUrl,
          posterUrlPreview: f.posterUrlPreview,
          genres: f.genres,
        }));
        return { keyword: q, pagesCount: 1, films } as T;
      }
      case "kp_film": {
        const id = Number(args?.id);
        return (FILMS.find((f) => f.kinopoiskId === id) ?? FILMS[0]) as T;
      }
      case "kp_images":
        return { total: 4, totalPages: 1, items: Array.from({ length: 4 }, () => ({ imageUrl: POSTER, previewUrl: POSTER })) } as T;
      case "kp_staff":
        return [
          { staffId: 1, nameRu: "Анна Волкова", posterUrl: POSTER, professionText: "Актриса", professionKey: "ACTOR" },
          { staffId: 2, nameRu: "Игорь Реброва", posterUrl: POSTER, professionText: "Актёр", professionKey: "ACTOR" },
          { staffId: 3, nameRu: "Марк Соловьёв", posterUrl: POSTER, professionText: "Режиссёр", professionKey: "DIRECTOR" },
        ] as T;
      case "kp_person": {
        const names: Record<number, string> = { 1: "Анна Волкова", 2: "Игорь Реброва", 3: "Марк Соловьёв" };
        const id = Number(args?.id);
        return {
          personId: id,
          nameRu: names[id] ?? "Актёр",
          posterUrl: POSTER,
          growth: "168",
          birthday: "1988-06-14",
          age: 37,
          birthplace: "Москва, Россия",
          profession: "Актриса, Продюсер",
          facts: ["Снималась в 20+ картинах.", "Дебютировала в кино в 2006 году."],
          films: FILMS.map((f) => ({
            filmId: f.kinopoiskId,
            nameRu: f.nameRu,
            year: String(f.year),
            rating: String(f.ratingKinopoisk),
            description: "Смотритель",
            professionKey: "ACTOR",
          })),
        } as T;
      }
      case "kp_genres":
        return {
          genres: [
            { id: 1, genre: "триллер" },
            { id: 2, genre: "драма" },
            { id: 3, genre: "криминал" },
            { id: 5, genre: "детектив" },
            { id: 6, genre: "фантастика" },
            { id: 7, genre: "приключения" },
            { id: 11, genre: "боевик" },
            { id: 12, genre: "фэнтези" },
            { id: 13, genre: "комедия" },
            { id: 17, genre: "ужасы" },
            { id: 18, genre: "мультфильм" },
            { id: 19, genre: "семейный" },
            { id: 24, genre: "аниме" },
            { id: 33, genre: "детский" },
          ],
        } as T;
      case "kp_similars": {
        const id = Number(args?.id);
        const items = FILMS.filter((f) => f.kinopoiskId !== id).map((f) => ({
          filmId: f.kinopoiskId,
          nameRu: f.nameRu,
          nameOriginal: f.nameOriginal,
          posterUrl: f.posterUrl,
          posterUrlPreview: f.posterUrlPreview,
        }));
        return { total: items.length, items } as T;
      }
      case "kp_videos":
        return { total: 0, items: [] } as T;
      case "kp_external_sources":
        return { total: 0, items: [] } as T;
      case "torapi_search_title":
        return releases(String(args?.query ?? "фильм")) as T;
      case "torapi_search_id":
        // Real API: a one-element array.
        return [
          {
            Name: "Релиз (NoNameClub)",
            Magnet: "magnet:?xt=urn:btih:06066A915197D6B4B2F3B79D2D6CBE4BCD1F8F81",
            Hash: "06066A915197D6B4B2F3B79D2D6CBE4BCD1F8F81",
            Torrent: "https://nnmclub.to/forum/download.php?id=1411580",
          },
        ] as T;
      case "torrserve_health":
        return true as T;
      case "ts_add_magnet":
        return { hash: String(args?.magnet ?? "").toLowerCase() } as T;
      case "ts_get_torrent":
        return {
          file_stats: [
            { id: 1, path: "Release/sample.mkv", length: 50_000_000 },
            { id: 2, path: "Release/movie.mkv", length: 6_400_000_000 },
            { id: 3, path: "Release/subs.srt", length: 90_000 },
          ],
          download_speed: 4_200_000 + Math.random() * 800_000,
          active_peers: 48,
          connected_seeders: 31,
          total_peers: 210,
        } as T;
      case "ts_stream_url":
        // Mirrors torrserve.rs::ts_stream_url so the file-picking logic is inspectable here.
        return `http://127.0.0.1:8090/stream/${encodeURIComponent(String(args?.fileName ?? "file.mkv"))}?link=${args?.hash}&index=${args?.fileIndex}&play=true` as T;
      default:
        throw new Error(`[mock] нет заглушки для команды "${cmd}" (нужен pnpm tauri dev)`);
    }
  },
};
