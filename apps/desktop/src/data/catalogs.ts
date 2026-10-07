import type { KpFilter, MetadataSource } from "./api";

export type CatalogKind = "films" | "series" | "cartoons";

export interface CatalogShelf {
  title: string;
  text?: string;
  /** A Kinopoisk collection type, or a genre/type filter. */
  source: { collection: string } | { filter: KpFilter };
}

// Kinopoisk genre ids (from /api/v2.2/films/filters, checked 2026-09-23).
const G = {
  thriller: 1,
  drama: 2,
  crime: 3,
  detective: 5,
  scifi: 6,
  adventure: 7,
  action: 11,
  fantasy: 12,
  comedy: 13,
  horror: 17,
  animation: 18,
  family: 19,
  anime: 24,
  kids: 33,
} as const;

const recentYear = new Date().getFullYear() - 1;

export const CATALOGS: Record<CatalogKind, { title: string; shelves: CatalogShelf[] }> = {
  films: {
    title: "Фильмы",
    shelves: [
      { title: "Популярно сейчас", text: "Самые обсуждаемые фильмы последних недель.", source: { collection: "TOP_POPULAR_MOVIES" } },
      {
        title: "Новинки",
        text: "Свежие фильмы, которые уже успели полюбить зрители.",
        source: { filter: { kind: "FILM", yearFrom: recentYear, ratingFrom: 6, order: "NUM_VOTE" } },
      },
      { title: "Боевики", text: "Погони, перестрелки и герои, которые не сдаются.", source: { filter: { kind: "FILM", genre: G.action, ratingFrom: 6 } } },
      { title: "Фантастика", text: "Космос, будущее и миры, которых не существует.", source: { filter: { kind: "FILM", genre: G.scifi, ratingFrom: 6 } } },
      { title: "Комедии", text: "Когда хочется просто посмеяться.", source: { filter: { kind: "FILM", genre: G.comedy, ratingFrom: 6 } } },
      { title: "Триллеры", text: "Напряжение до последней минуты.", source: { filter: { kind: "FILM", genre: G.thriller, ratingFrom: 6 } } },
      { title: "Ужасы", text: "Смотреть лучше не в одиночку.", source: { filter: { kind: "FILM", genre: G.horror, ratingFrom: 5 } } },
      { title: "Драмы", text: "Истории, которые остаются с тобой после титров.", source: { filter: { kind: "FILM", genre: G.drama, ratingFrom: 7 } } },
      { title: "Лучшие за всё время", text: "250 фильмов с самым высоким рейтингом Кинопоиска.", source: { collection: "TOP_250_MOVIES" } },
    ],
  },
  series: {
    title: "Сериалы",
    shelves: [
      { title: "Популярные сериалы", text: "То, что смотрят прямо сейчас.", source: { collection: "POPULAR_SERIES" } },
      {
        title: "Новые сезоны и премьеры",
        text: "Сериалы последнего года с высоким рейтингом.",
        source: { filter: { kind: "TV_SERIES", yearFrom: recentYear, ratingFrom: 6, order: "NUM_VOTE" } },
      },
      { title: "Криминальные", text: "Расследования, мафия и тёмная сторона закона.", source: { filter: { kind: "TV_SERIES", genre: G.crime, ratingFrom: 7 } } },
      { title: "Фантастика и фэнтези", text: "Другие миры на много сезонов вперёд.", source: { filter: { kind: "TV_SERIES", genre: G.scifi, ratingFrom: 7 } } },
      { title: "Комедийные", text: "Короткие серии — отличное настроение.", source: { filter: { kind: "TV_SERIES", genre: G.comedy, ratingFrom: 7 } } },
      { title: "Драмы", text: "Сериалы, от которых невозможно оторваться.", source: { filter: { kind: "TV_SERIES", genre: G.drama, ratingFrom: 8 } } },
      { title: "Мини-сериалы", text: "Одна законченная история за несколько вечеров.", source: { filter: { kind: "MINI_SERIES", ratingFrom: 7 } } },
      { title: "Лучшие сериалы", text: "250 сериалов с самым высоким рейтингом Кинопоиска.", source: { collection: "TOP_250_TV_SHOWS" } },
    ],
  },
  cartoons: {
    title: "Мультфильмы",
    shelves: [
      { title: "Популярные мультфильмы", text: "Любимые мультфильмы детей и взрослых.", source: { collection: "KIDS_ANIMATION_THEME" } },
      {
        title: "Новые мультфильмы",
        text: "Свежая анимация последнего года.",
        source: { filter: { kind: "FILM", genre: G.animation, yearFrom: recentYear, order: "NUM_VOTE" } },
      },
      { title: "Лучшие полнометражные", text: "Классика анимации с самым высоким рейтингом.", source: { filter: { kind: "FILM", genre: G.animation, ratingFrom: 7 } } },
      { title: "Мультсериалы", text: "Много серий любимых героев.", source: { filter: { kind: "TV_SERIES", genre: G.animation, ratingFrom: 7 } } },
      { title: "Аниме", text: "Японская анимация: от Миядзаки до современных хитов.", source: { filter: { kind: "FILM", genre: G.anime, ratingFrom: 7 } } },
      { title: "Аниме-сериалы", text: "Длинные истории, которые затягивают.", source: { filter: { kind: "TV_SERIES", genre: G.anime, ratingFrom: 7 } } },
      { title: "Для самых маленьких", text: "Добрые мультфильмы для детей.", source: { filter: { kind: "ALL", genre: G.kids, ratingFrom: 6 } } },
      { title: "Семейные", text: "Приключения, которые интересно смотреть всей семьёй.", source: { filter: { kind: "FILM", genre: G.family, ratingFrom: 7 } } },
    ],
  },
};

export interface CategoryDef {
  title: string;
  filter: KpFilter;
}

/** Genre list per catalog kind — the "Категории" screen (styled like the TV channels'
 *  category list). Picking one opens a full poster grid for that genre/type combo. */
export const CATEGORY_LISTS: Record<CatalogKind, CategoryDef[]> = {
  films: [
    { title: "Боевики", filter: { kind: "FILM", genre: G.action, ratingFrom: 5 } },
    { title: "Фантастика", filter: { kind: "FILM", genre: G.scifi, ratingFrom: 5 } },
    { title: "Комедии", filter: { kind: "FILM", genre: G.comedy, ratingFrom: 5 } },
    { title: "Триллеры", filter: { kind: "FILM", genre: G.thriller, ratingFrom: 5 } },
    { title: "Ужасы", filter: { kind: "FILM", genre: G.horror, ratingFrom: 4 } },
    { title: "Драмы", filter: { kind: "FILM", genre: G.drama, ratingFrom: 5 } },
    { title: "Криминал", filter: { kind: "FILM", genre: G.crime, ratingFrom: 5 } },
    { title: "Детективы", filter: { kind: "FILM", genre: G.detective, ratingFrom: 5 } },
    { title: "Фэнтези", filter: { kind: "FILM", genre: G.fantasy, ratingFrom: 5 } },
    { title: "Приключения", filter: { kind: "FILM", genre: G.adventure, ratingFrom: 5 } },
    { title: "Семейные", filter: { kind: "FILM", genre: G.family, ratingFrom: 5 } },
  ],
  series: [
    { title: "Криминальные", filter: { kind: "TV_SERIES", genre: G.crime, ratingFrom: 6 } },
    { title: "Фантастика и фэнтези", filter: { kind: "TV_SERIES", genre: G.scifi, ratingFrom: 6 } },
    { title: "Комедийные", filter: { kind: "TV_SERIES", genre: G.comedy, ratingFrom: 6 } },
    { title: "Драмы", filter: { kind: "TV_SERIES", genre: G.drama, ratingFrom: 6 } },
    { title: "Триллеры", filter: { kind: "TV_SERIES", genre: G.thriller, ratingFrom: 6 } },
    { title: "Детективы", filter: { kind: "TV_SERIES", genre: G.detective, ratingFrom: 6 } },
    { title: "Приключения", filter: { kind: "TV_SERIES", genre: G.adventure, ratingFrom: 6 } },
    { title: "Мини-сериалы", filter: { kind: "MINI_SERIES", ratingFrom: 6 } },
  ],
  cartoons: [
    { title: "Полнометражные", filter: { kind: "FILM", genre: G.animation, ratingFrom: 5 } },
    { title: "Мультсериалы", filter: { kind: "TV_SERIES", genre: G.animation, ratingFrom: 5 } },
    { title: "Аниме", filter: { kind: "FILM", genre: G.anime, ratingFrom: 5 } },
    { title: "Аниме-сериалы", filter: { kind: "TV_SERIES", genre: G.anime, ratingFrom: 5 } },
    { title: "Для самых маленьких", filter: { kind: "ALL", genre: G.kids, ratingFrom: 4 } },
    { title: "Семейные", filter: { kind: "FILM", genre: G.family, ratingFrom: 5 } },
    { title: "Приключения", filter: { kind: "FILM", genre: G.adventure, ratingFrom: 5 } },
    { title: "Фэнтези", filter: { kind: "FILM", genre: G.fantasy, ratingFrom: 5 } },
  ],
};

// ---------- TMDB ----------
// TMDB numbers genres differently from Kinopoisk (and differently for movies and TV), has no
// anime genre, and has its own native lists — so its catalogs are written separately instead
// of translating the Kinopoisk ones. Ids from /genre/movie/list and /genre/tv/list.

const TM = {
  movie: { action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80, drama: 18, family: 10751, fantasy: 14, horror: 27, mystery: 9648, scifi: 878, thriller: 53 },
  tv: { actionAdventure: 10759, animation: 16, comedy: 35, crime: 80, drama: 18, kids: 10762, mystery: 9648, scifiFantasy: 10765 },
} as const;

export const TMDB_CATALOGS: Record<CatalogKind, { title: string; shelves: CatalogShelf[] }> = {
  films: {
    title: "Фильмы",
    shelves: [
      { title: "Популярно сейчас", text: "Что смотрят во всём мире прямо сейчас.", source: { collection: "TMDB_MOVIE_POPULAR" } },
      { title: "В тренде за неделю", text: "Фильмы, о которых больше всего говорили за последние дни.", source: { collection: "TMDB_TRENDING_MOVIE" } },
      { title: "Сейчас в кино", text: "Идут в кинотеатрах.", source: { collection: "TMDB_MOVIE_NOW_PLAYING" } },
      { title: "Скоро в кино", text: "Премьеры, которых ждут.", source: { collection: "TMDB_MOVIE_UPCOMING" } },
      { title: "Боевики", text: "Погони, перестрелки и герои, которые не сдаются.", source: { filter: { kind: "FILM", genre: TM.movie.action, ratingFrom: 6 } } },
      { title: "Фантастика", text: "Космос, будущее и миры, которых не существует.", source: { filter: { kind: "FILM", genre: TM.movie.scifi, ratingFrom: 6 } } },
      { title: "Комедии", text: "Когда хочется просто посмеяться.", source: { filter: { kind: "FILM", genre: TM.movie.comedy, ratingFrom: 6 } } },
      { title: "Триллеры", text: "Напряжение до последней минуты.", source: { filter: { kind: "FILM", genre: TM.movie.thriller, ratingFrom: 6 } } },
      { title: "Ужасы", text: "Смотреть лучше не в одиночку.", source: { filter: { kind: "FILM", genre: TM.movie.horror, ratingFrom: 5.5 } } },
      { title: "Драмы", text: "Истории, которые остаются с тобой после титров.", source: { filter: { kind: "FILM", genre: TM.movie.drama, ratingFrom: 7 } } },
      { title: "Лучшие за всё время", text: "Фильмы с самым высоким рейтингом TMDB.", source: { collection: "TMDB_MOVIE_TOP_RATED" } },
    ],
  },
  series: {
    title: "Сериалы",
    shelves: [
      { title: "Популярные сериалы", text: "То, что смотрят прямо сейчас.", source: { collection: "TMDB_TV_POPULAR" } },
      { title: "В тренде за неделю", text: "Сериалы, которые обсуждают больше всего.", source: { collection: "TMDB_TRENDING_TV" } },
      { title: "Выходят сейчас", text: "Идут новые серии.", source: { collection: "TMDB_TV_ON_THE_AIR" } },
      { title: "Криминальные", text: "Расследования, мафия и тёмная сторона закона.", source: { filter: { kind: "TV_SERIES", genre: TM.tv.crime, ratingFrom: 7 } } },
      { title: "Фантастика и фэнтези", text: "Другие миры на много сезонов вперёд.", source: { filter: { kind: "TV_SERIES", genre: TM.tv.scifiFantasy, ratingFrom: 7 } } },
      { title: "Боевики и приключения", text: "Экшен, который не отпускает.", source: { filter: { kind: "TV_SERIES", genre: TM.tv.actionAdventure, ratingFrom: 7 } } },
      { title: "Комедийные", text: "Короткие серии — отличное настроение.", source: { filter: { kind: "TV_SERIES", genre: TM.tv.comedy, ratingFrom: 7 } } },
      { title: "Драмы", text: "Сериалы, от которых невозможно оторваться.", source: { filter: { kind: "TV_SERIES", genre: TM.tv.drama, ratingFrom: 8 } } },
      { title: "Детективы", text: "Загадки, улики и неожиданные развязки.", source: { filter: { kind: "TV_SERIES", genre: TM.tv.mystery, ratingFrom: 7 } } },
      { title: "Лучшие сериалы", text: "Сериалы с самым высоким рейтингом TMDB.", source: { collection: "TMDB_TV_TOP_RATED" } },
    ],
  },
  cartoons: {
    title: "Мультфильмы",
    shelves: [
      { title: "Популярные мультфильмы", text: "Любимые мультфильмы детей и взрослых.", source: { filter: { kind: "FILM", genre: TM.movie.animation, ratingFrom: 6, order: "NUM_VOTE" } } },
      { title: "Новые мультфильмы", text: "Свежая анимация последнего года.", source: { filter: { kind: "FILM", genre: TM.movie.animation, yearFrom: recentYear, order: "NUM_VOTE" } } },
      { title: "Лучшие полнометражные", text: "Классика анимации с самым высоким рейтингом.", source: { filter: { kind: "FILM", genre: TM.movie.animation, ratingFrom: 7.5, order: "RATING" } } },
      { title: "Мультсериалы", text: "Много серий любимых героев.", source: { filter: { kind: "TV_SERIES", genre: TM.tv.animation, ratingFrom: 7, order: "NUM_VOTE" } } },
      { title: "Аниме", text: "Японская анимация: от Миядзаки до современных хитов.", source: { filter: { kind: "FILM", genre: TM.movie.animation, language: "ja", ratingFrom: 7 } } },
      { title: "Аниме-сериалы", text: "Длинные истории, которые затягивают.", source: { filter: { kind: "TV_SERIES", genre: TM.tv.animation, language: "ja", ratingFrom: 7 } } },
      { title: "Для самых маленьких", text: "Добрые мультфильмы для детей.", source: { filter: { kind: "TV_SERIES", genre: TM.tv.kids, ratingFrom: 6 } } },
      { title: "Семейные", text: "Приключения, которые интересно смотреть всей семьёй.", source: { filter: { kind: "FILM", genre: TM.movie.family, ratingFrom: 7 } } },
    ],
  },
};

export const TMDB_CATEGORY_LISTS: Record<CatalogKind, CategoryDef[]> = {
  films: [
    { title: "Боевики", filter: { kind: "FILM", genre: TM.movie.action, ratingFrom: 5 } },
    { title: "Фантастика", filter: { kind: "FILM", genre: TM.movie.scifi, ratingFrom: 5 } },
    { title: "Комедии", filter: { kind: "FILM", genre: TM.movie.comedy, ratingFrom: 5 } },
    { title: "Триллеры", filter: { kind: "FILM", genre: TM.movie.thriller, ratingFrom: 5 } },
    { title: "Ужасы", filter: { kind: "FILM", genre: TM.movie.horror, ratingFrom: 5 } },
    { title: "Драмы", filter: { kind: "FILM", genre: TM.movie.drama, ratingFrom: 5 } },
    { title: "Криминал", filter: { kind: "FILM", genre: TM.movie.crime, ratingFrom: 5 } },
    { title: "Детективы", filter: { kind: "FILM", genre: TM.movie.mystery, ratingFrom: 5 } },
    { title: "Фэнтези", filter: { kind: "FILM", genre: TM.movie.fantasy, ratingFrom: 5 } },
    { title: "Приключения", filter: { kind: "FILM", genre: TM.movie.adventure, ratingFrom: 5 } },
    { title: "Семейные", filter: { kind: "FILM", genre: TM.movie.family, ratingFrom: 5 } },
  ],
  series: [
    { title: "Криминальные", filter: { kind: "TV_SERIES", genre: TM.tv.crime, ratingFrom: 6 } },
    { title: "Фантастика и фэнтези", filter: { kind: "TV_SERIES", genre: TM.tv.scifiFantasy, ratingFrom: 6 } },
    { title: "Боевики и приключения", filter: { kind: "TV_SERIES", genre: TM.tv.actionAdventure, ratingFrom: 6 } },
    { title: "Комедийные", filter: { kind: "TV_SERIES", genre: TM.tv.comedy, ratingFrom: 6 } },
    { title: "Драмы", filter: { kind: "TV_SERIES", genre: TM.tv.drama, ratingFrom: 6 } },
    { title: "Детективы", filter: { kind: "TV_SERIES", genre: TM.tv.mystery, ratingFrom: 6 } },
  ],
  cartoons: [
    { title: "Полнометражные", filter: { kind: "FILM", genre: TM.movie.animation, ratingFrom: 5 } },
    { title: "Мультсериалы", filter: { kind: "TV_SERIES", genre: TM.tv.animation, ratingFrom: 5 } },
    { title: "Аниме", filter: { kind: "FILM", genre: TM.movie.animation, language: "ja", ratingFrom: 5 } },
    { title: "Аниме-сериалы", filter: { kind: "TV_SERIES", genre: TM.tv.animation, language: "ja", ratingFrom: 5 } },
    { title: "Для самых маленьких", filter: { kind: "TV_SERIES", genre: TM.tv.kids, ratingFrom: 5 } },
    { title: "Семейные", filter: { kind: "FILM", genre: TM.movie.family, ratingFrom: 5 } },
    { title: "Приключения", filter: { kind: "FILM", genre: TM.movie.adventure, ratingFrom: 5 } },
    { title: "Фэнтези", filter: { kind: "FILM", genre: TM.movie.fantasy, ratingFrom: 5 } },
  ],
};

/** The catalog pages' shelves / category lists for the active metadata source. */
export const catalogsFor = (source: MetadataSource) => (source === "tmdb" ? TMDB_CATALOGS : CATALOGS);
export const categoryListsFor = (source: MetadataSource) => (source === "tmdb" ? TMDB_CATEGORY_LISTS : CATEGORY_LISTS);
