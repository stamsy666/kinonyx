import { useEffect, useState } from "react";
import { FullscreenButton } from "../components/FullscreenButton";
import { WhatToWatchModal } from "../components/WhatToWatchModal";
import { PopcornIcon } from "../components/AnimatedIcons";
import { Focusable, FocusGroup, OfflineIcon, SearchIcon, Spinner } from "@kinonyx/ui";
import { EmptyState } from "../components/EmptyState";
import logoMark from "../assets/logo-mark.png";
import { useApp } from "../store/app";
import { useFavorites } from "../store/favorites";
import { useChannelFavorites } from "../store/channelFavorites";
import { useContinueWatching } from "../store/continueWatching";
import { useTimetable } from "../store/timetable";
import { episodeCode, pickNext, pickRecent, whenLabel } from "../data/timetable";
import { useTv } from "../store/tv";
import type { Channel } from "@kinonyx/epg";
import { kpCollection, kpSimilars, KP_COLLECTIONS, type KpCollectionItem } from "../data/api";
import { HeroCarousel } from "../components/HeroCarousel";
import { useHomeFeel } from "../components/useHomeFeel";
import { fadeThrough } from "../data/transition";
import { LazyShelf } from "../components/LazyShelf";
import { RowScroll } from "../components/RowScroll";
import { MovieCard } from "../components/MovieCard";
import { ChannelTile } from "../components/ChannelTile";
import { Modal } from "../components/Modal";

interface ShelfDef {
  kind: string;
  title: string;
  text: string;
  limit?: number;
  ranked?: boolean;
  /** How the shelf looks on the page (see LazyShelf). */
  variant?: "posters" | "feature" | "banner";
}

// Kinopoisk collection types, see /api/v2.2/films/collections. Each costs one request per
// 6 hours (disk-cached on the Rust side), well inside the free key's 500/day.
const SHELVES: ShelfDef[] = [
  {
    kind: KP_COLLECTIONS.popular,
    title: "Топ-10 популярных фильмов месяца",
    text: "То, что смотрят и обсуждают прямо сейчас.",
    limit: 10,
    ranked: true,
  },
  {
    kind: "TOP_100_GREATEST_MOVIES_XXI",
    title: "Великие фильмы XXI века",
    text: "Главное кино нового века по версии критиков.",
    variant: "feature",
  },
  {
    kind: "TOP_250_MOVIES",
    title: "Лучшие фильмы всех времён",
    text: "Классика с самым высоким рейтингом зрителей Кинопоиска.",
  },
  {
    kind: "COMICS_THEME",
    title: "Вселенные комиксов",
    text: "Супергерои, антигерои и целые киновселенные — от первых экранизаций до новейших блокбастеров.",
    variant: "banner",
  },
  {
    kind: "CATASTROPHE_THEME",
    title: "Когда рушится мир",
    text: "Фильмы-катастрофы: стихия, выживание и люди, которые не сдаются.",
    variant: "feature",
  },
  {
    kind: "FAMILY",
    title: "Для всей семьи",
    text: "Добрые и смешные истории, которые можно смотреть вместе — и детям, и взрослым.",
    variant: "banner",
  },
];

// TMDB has none of Kinopoisk's themed collections (the unknown ones all fall back to plain
// "popular", which would repeat the first shelf three times) — its own lists instead.
const HOME_SHELVES_TMDB: ShelfDef[] = [
  {
    kind: "TMDB_MOVIE_POPULAR",
    title: "Топ-10 популярных фильмов",
    text: "То, что смотрят и обсуждают прямо сейчас.",
    limit: 10,
    ranked: true,
  },
  {
    kind: "TMDB_TRENDING_MOVIE",
    title: "В тренде за неделю",
    text: "Фильмы, о которых больше всего говорили за последние дни.",
    variant: "feature",
  },
  {
    kind: "TMDB_MOVIE_NOW_PLAYING",
    title: "Сейчас в кино",
    text: "Идут в кинотеатрах — самое время выбрать, на что пойти.",
  },
  {
    kind: "TMDB_TV_POPULAR",
    title: "Популярные сериалы",
    text: "Новые и долгие истории, которые смотрят прямо сейчас.",
    variant: "banner",
  },
  {
    kind: "TMDB_MOVIE_TOP_RATED",
    title: "Лучшие фильмы всех времён",
    text: "Классика с самым высоким рейтингом зрителей TMDB.",
  },
  {
    kind: "TMDB_MOVIE_UPCOMING",
    title: "Скоро в кино",
    text: "Премьеры, которых ждут.",
    variant: "feature",
  },
];

/** How many of the newest favorites seed "Похожее на избранное" — each is one (disk-cached) request. */
const SIMILAR_SEEDS = 3;

/** Films similar to the newest favorites, deduplicated, minus anything already favorited or
 *  in progress. Favorites still on the other source's ids are skipped — asking this source
 *  for "similar to <other source's id>" would return unrelated films. */
async function loadSimilarToFavorites(seeds: number[], exclude: Set<number>): Promise<KpCollectionItem[]> {
  const lists = await Promise.all(seeds.map((id) => kpSimilars(id).then((r) => r.items ?? []).catch(() => [])));
  const seen = new Set(exclude);
  const out: KpCollectionItem[] = [];
  // Round-robin, so one favorite with many similars doesn't crowd the others out.
  for (let i = 0; out.length < 20 && lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      const s = list[i];
      if (!s || seen.has(s.filmId)) continue;
      seen.add(s.filmId);
      out.push({
        kinopoiskId: s.filmId,
        nameRu: s.nameRu,
        nameOriginal: s.nameOriginal,
        posterUrl: s.posterUrl,
        posterUrlPreview: s.posterUrlPreview,
      });
    }
  }
  return out;
}

export function HomeScreen() {
  const navigate = useApp((s) => s.navigate);
  const metadataSource = useApp((s) => s.metadataSource);
  const shelves = metadataSource === "tmdb" ? HOME_SHELVES_TMDB : SHELVES;
  const favorites = useFavorites((s) => s.items);
  const favoriteChannels = useChannelFavorites((s) => s.items);
  // Most-recently-touched first — that's the one you're most likely picking back up.
  const continueWatching = useContinueWatching((s) => s.items).slice().sort((a, b) => b.updatedAt - a.updatedAt);
  // The schedule of the favourite series: what is coming and what came out lately.
  const timetable = useTimetable((s) => s.episodes);
  const upcoming = pickNext(timetable).flatMap((e) => {
    const film = favorites.find((f) => f.kinopoiskId === e.filmId);
    return film ? [{ film, e }] : [];
  });
  const recent = pickRecent(timetable).flatMap((e) => {
    const film = favorites.find((f) => f.kinopoiskId === e.filmId);
    return film ? [{ film, e }] : [];
  });
  // Deliberately NOT the same collection as the "Топ-10 популярных" shelf right below —
  // showing the top of that same list twice in one screen made the hero feel redundant.
  // A ratingFrom/order filter for the very highest-rated titles gives the banner its own
  // reason to exist ("legends", not just "already popular") — and unlike a fixed
  // collection id, `kp_films_filter` is the same proven code path every genre shelf in
  // the app already uses, so it doesn't risk an unverified collection type 400ing.
  const [hero, setHero] = useState<KpCollectionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [wtwOpen, setWtwOpen] = useState(false);
  const toggleSidebar = useApp((s) => s.toggleSidebar);

  useHomeFeel(hero);
  const seeds = favorites
    .filter((f) => (f.source ?? "kinopoisk") === metadataSource)
    .slice(0, SIMILAR_SEEDS)
    .map((f) => f.kinopoiskId);
  const seedKey = seeds.join(",");

  useEffect(() => {
    let cancelled = false;
    // What is popular right now: the banner turns through the top of the same chart as the first shelf.
    kpCollection(shelves[0].kind, 1)
      .then((res) => !cancelled && setHero(res.items ?? []))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [metadataSource]);

  const open = (film: KpCollectionItem) => navigate({ name: "movie", id: film.kinopoiskId, preview: film });
  // A favourited channel's own playlist may not be the one currently loaded (or none
  // may be loaded yet, right after launch) — load it first, same as picking it from the
  // "Каналы" list would, just without that flow's "go to categories" side effect.
  const openChannel = async (playlistId: string, saved: Channel) => {
    const ok = await useTv.getState().ensurePlaylistLoaded(playlistId);
    // Silently doing nothing here reads exactly like a dead/broken button — the
    // playlist's own error (network, bad file, no channels) is already on the store.
    if (!ok) return setChannelError(useTv.getState().playlistError ?? "Не удалось загрузить плейлист этого канала.");
    // A favourite saved before channel ids ignored the provider's rotating link token (or
    // after the provider reshuffled its URLs) won't match by id — fall back to the same
    // channel by tvg-id + name, then by name, and store the current version.
    const channels = useTv.getState().playlist?.channels ?? [];
    const current =
      channels.find((c) => c.id === saved.id) ??
      (saved.tvgId ? channels.find((c) => c.tvgId === saved.tvgId && c.name === saved.name) : undefined) ??
      channels.find((c) => c.name === saved.name);
    if (!current) return setChannelError("Этого канала больше нет в плейлисте.");
    if (current.id !== saved.id) useChannelFavorites.getState().relink(playlistId, saved.id, current);
    // The same soft hand-over as from the channel list: the page goes dark, the player opens under it.
    fadeThrough(() => navigate({ name: "tv-player", channelId: current.id }));
  };

  return (
    <FocusGroup focusKey="home" className="screen-pad home home--tv">
      {/* The page's own top: a round glass button that opens the menu on the left, and two small
          buttons on the right. It fades away as the page scrolls. */}
      <div className="home__chrome">
        <Focusable
          as="button"
          className="home-round"
          focusKey="home:menu"
          scroll={false}
          onFocus={() => document.querySelector(".app-body")?.scrollTo({ top: 0, behavior: "smooth" })}
          onArrowPress={(dir) => (dir === "down" ? (setFocusSafe("hero:details"), false) : true)}
          onPress={toggleSidebar}
        >
          {/* Three lines that draw themselves one after another on focus (menu-icon in theme.css). */}
          <svg className="menu-icon" width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
              <path d="M5 5h14" />
              <path d="M5 12h14" />
              <path d="M5 19h14" />
            </g>
          </svg>
        </Focusable>
        <div className="topbar__logo home__brand" aria-hidden="true">
          <img className="topbar__logo-mark" src={logoMark} alt="" />
          <span>
            KINON<em>YX</em>
          </span>
        </div>
        <div className="home__chrome-right">
          <Focusable as="button" className="home-round" focusKey="home:search" scroll={false} onPress={() => navigate({ name: "search" })}>
            <SearchIcon size={24} />
          </Focusable>
          <Focusable as="button" className="home-round" focusKey="home:wtw" scroll={false} onPress={() => setWtwOpen(true)}>
            <PopcornIcon />
          </Focusable>
          <FullscreenButton focusKey="home:fullscreen" className="home-round" />
        </div>
      </div>
      {error && <EmptyState error icon={<OfflineIcon size={38} strokeWidth={1.6} />} title="Не удалось загрузить подборку" hint={error} />}
      {!hero && !error && (
        <div style={{ display: "grid", placeItems: "center", height: 300 }}>
          <Spinner />
        </div>
      )}
      {hero && <HeroCarousel films={hero} onOpen={open} />}
      {/* The shelves sit on a sheet that rises over the foot of the banner. */}
      {hero && (
        <div className="home__rows">
      {hero && metadataSource && (
        <LazyShelf
          key={shelves[0].kind}
          title={shelves[0].title}
          text={shelves[0].text}
          load={() => kpCollection(shelves[0].kind, 1).then((r) => r.items ?? [])}
          focusPrefix="shelf0"
          limit={shelves[0].limit}
          ranked={shelves[0].ranked}
          onOpen={open}
        />
      )}
      {/* Right after "Топ-10 популярных" — visible as soon as there's even one favourite,
          grows as the viewer adds more, gone entirely until then. */}
      {hero && favorites.length > 0 && (
        <RowScroll label="Избранное" description="Фильмы, которые вы отметили сердечком." count={favorites.length}>
          {/* Keyed by film, not position: both shelves reorder (newest first), and Back's
              focus restore must land on the same film, not whatever took its slot. */}
          {favorites.map((film) => (
            <MovieCard key={film.kinopoiskId} film={film} focusKey={`favorites-shelf:${film.kinopoiskId}`} onPress={() => open(film)} />
          ))}
        </RowScroll>
      )}
      {hero && continueWatching.length > 0 && (
        <RowScroll label="Продолжить просмотр" description="То, что вы не досмотрели до конца." count={continueWatching.length}>
          {continueWatching.map((e) => (
            <MovieCard
              key={e.filmId}
              film={{ kinopoiskId: e.filmId, nameRu: e.title, posterUrlPreview: e.poster }}
              focusKey={`continue-shelf:${e.filmId}`}
              progress={e.position / e.duration}
              onPress={() => navigate({ name: "movie", id: e.filmId, preview: { kinopoiskId: e.filmId, nameRu: e.title, posterUrlPreview: e.poster } })}
            />
          ))}
        </RowScroll>
      )}
      {hero && upcoming.length > 0 && (
        <RowScroll label="Скоро новые серии" description="Выйдут в ближайшее время у сериалов из избранного." count={upcoming.length}>
          {upcoming.map(({ film, e }) => (
            <MovieCard key={`${film.kinopoiskId}:${episodeCode(e)}`} film={film} focusKey={`upcoming-shelf:${film.kinopoiskId}`} tag={`${episodeCode(e)} · ${whenLabel(e.date)}`} onPress={() => open(film)} />
          ))}
        </RowScroll>
      )}
      {hero && recent.length > 0 && (
        <RowScroll label="Недавние серии" description="Вышли за последние две недели." count={recent.length}>
          {recent.map(({ film, e }) => (
            <MovieCard key={`${film.kinopoiskId}:${episodeCode(e)}`} film={film} focusKey={`recent-shelf:${film.kinopoiskId}`} tag={`${episodeCode(e)} · ${whenLabel(e.date)}`} onPress={() => open(film)} />
          ))}
        </RowScroll>
      )}
      {hero && favoriteChannels.length > 0 && (
        <RowScroll label="Избранные каналы" description="Каналы, отмеченные сердечком в плеере." count={favoriteChannels.length}>
          {favoriteChannels.map((f) => (
            <ChannelTile
              key={`${f.playlistId}:${f.channel.id}`}
              channel={f.channel}
              onOpen={() => void openChannel(f.playlistId, f.channel)}
            />
          ))}
        </RowScroll>
      )}
      {hero && metadataSource && seeds.length > 0 && (
        <LazyShelf
          // Keyed by the seeds: a new favorite must reload it, an unrelated re-render must not.
          key={`similar:${seedKey}`}
          title="Похожее на избранное"
          text="Подобрано по фильмам, которые вы отметили сердечком."
          load={() =>
            loadSimilarToFavorites(
              seeds,
              new Set([...useFavorites.getState().items.map((f) => f.kinopoiskId), ...continueWatching.map((e) => e.filmId)]),
            )
          }
          focusPrefix="similar-shelf"
          onOpen={open}
        />
      )}
      {hero &&
        metadataSource &&
        shelves.slice(1).map((shelf, i) => (
          <LazyShelf
            key={shelf.kind}
            title={shelf.title}
            text={shelf.text}
            load={() => kpCollection(shelf.kind, 1).then((r) => r.items ?? [])}
            focusPrefix={`shelf${i + 1}`}
            limit={shelf.limit}
            ranked={shelf.ranked}
            variant={shelf.variant}
            onOpen={open}
          />
        ))}
        </div>
      )}
      {wtwOpen && (
        <WhatToWatchModal
          onClose={() => setWtwOpen(false)}
          onOpenFilm={(film) => {
            setWtwOpen(false);
            open(film);
          }}
        />
      )}
      {channelError && (
        <Modal focusKey="channel-error" preferredChildFocusKey="channel-err:close" onClose={() => setChannelError(null)}>
          <div className="modal-panel__header">
            <h3>Не удалось открыть канал</h3>
            <Focusable back as="button" className="icon-btn" focusKey="channel-err:close" onPress={() => setChannelError(null)} scroll={false} autoFocus>
              ×
            </Focusable>
          </div>
          <p className="empty" style={{ padding: "0 20px 20px" }}>
            {channelError}
          </p>
        </Modal>
      )}
    </FocusGroup>
  );
}

/** Moves the focus if the target exists (the banner may still be loading). */
function setFocusSafe(key: string) {
  void import("@noriginmedia/norigin-spatial-navigation").then(({ doesFocusableExist, setFocus }) => {
    if (doesFocusableExist(key)) setFocus(key);
  });
}
