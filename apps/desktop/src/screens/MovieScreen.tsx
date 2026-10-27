import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cancelGlides, DownloadIcon, FavoriteIcon, Focusable, FocusGroup, NextIcon, OfflineIcon, PlayIcon, PlusIcon, Spinner } from "@kinonyx/ui";
import { EmptyState } from "../components/EmptyState";
import { useApp } from "../store/app";
import { useFavorites } from "../store/favorites";
import { useLastRelease } from "../store/lastRelease";
import {
  kpFilm,
  kpGenres,
  kpImages,
  kpSimilars,
  kpStaff,
  kpVideos,
  resolveTrailerUrl,
  type KpCollectionItem,
  type KpGenre,
  type KpImage,
  type KpSimilarFilm,
  type KpStaffPerson,
  type TorrentFile,
} from "../data/api";
import { img, stillCard, stillLarge } from "../data/images";
import { Lightbox } from "../components/Lightbox";
import { preloadImage } from "../data/imagePreload";
import { RESTORE_DETAILS } from "../data/focusRestore";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { openExternal } from "../data/io";
import { RowScroll } from "../components/RowScroll";
import { MovieCard } from "../components/MovieCard";
import { ReleasePickerModal } from "../components/ReleasePickerModal";
import { enqueueDownload, pickDownloadDir } from "../store/downloads";
import { captureImdb } from "../data/imdbIds";
import { LinksModal, type Link } from "../components/LinksModal";
import { QUALITY_OPTIONS, type QualityKey } from "../data/quality";
import { continueLabel } from "../store/episodeProgress";
import { Modal } from "../components/Modal";
import { ProgressiveImg } from "../components/ProgressiveImg";
import { holdMusic } from "../data/music";
import { fadeThrough } from "../data/transition";
import { MovieBackdrop } from "../components/MovieBackdrop";
import { isYoutubeUrl, makeTrailer, type BackdropTrailer } from "../data/backdropTrailer";
import { HomeChrome } from "../components/HomeChrome";
import { useHomeFeel } from "../components/useHomeFeel";

/** What the page shows — both a collection/search card and a full film record have it. */
interface FilmView {
  nameRu?: string;
  nameOriginal?: string;
  year?: string | number;
  description?: string;
  ratingKinopoisk?: number;
  posterUrl?: string;
  posterUrlPreview?: string;
  genres?: KpGenre[];
  /** Minutes. Only the full record has it — cards from collections/search don't. */
  filmLength?: number;
  premiereRu?: string;
  premiereWorld?: string;
  premiereDigital?: string;
}

const MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** The earliest premiere date the record has, however it fell — `null` if none parses. */
function premiereOf(film: FilmView): Date | null {
  for (const s of [film.premiereRu, film.premiereWorld, film.premiereDigital]) {
    if (!s) continue;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function formatPremiere(d: Date): string {
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`;
}


/** "2 ч 25 мин" from minutes. */
function formatLength(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} ч${m ? ` ${m} мин` : ""}` : `${m} мин`;
}

/** The page goes back to its top when a button of the first screen gets the focus. */
const toTop = () => {
  cancelGlides();
  document.querySelector(".app-body")?.scrollTo({ top: 0, behavior: "smooth" });
};

type Modal = "watch" | "quality" | "trailer" | "download" | null;

// Kinopoisk's own videos list mixes real YouTube trailers with entries that just point
// at its own embeddable widget player (widgets.kinopoisk.ru/.../trailer/...) — those
// only work inside a browser frame on kinopoisk.ru itself, yt-dlp has no extractor for
// them, and mpv can't play them either. Only route the former into the app's own player.
// (isYoutubeUrl — data/backdropTrailer.ts)

/** Pseudo-entry in the trailer list: no YouTube link to open, search Rutube by name instead. */
const RUTUBE_AUTO = "rutube:auto";

const normalizeGenre = (s: string) => s.trim().toLowerCase();

export function MovieScreen({ id, preview }: { id: number; preview?: KpCollectionItem }) {
  const navigate = useApp((s) => s.navigate);
  const [film, setFilm] = useState<FilmView | null>(preview ?? null);
  const [images, setImages] = useState<KpImage[]>([]);
  const [staff, setStaff] = useState<KpStaffPerson[]>([]);
  const [similars, setSimilars] = useState<KpSimilarFilm[]>([]);
  const [trailers, setTrailers] = useState<Link[] | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  // A still opens straight into the full-window viewer (index of the open one, null = closed).
  const [stillOpen, setStillOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trailerResolving, setTrailerResolving] = useState(false);
  const [trailerError, setTrailerError] = useState<{ message: string; url: string } | null>(null);
  // The trailer is the backdrop (`trailerLive`) and, once "Трейлер" is pressed, grows over the whole page (`expanded`).
  // `settling` keeps the fade of the page's text on for a moment after either change.
  const [trailerLive, setTrailerLive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // A trailer picked from the list: the page's own player plays it (grown), in place of the backdrop's.
  const [chosen, setChosen] = useState<BackdropTrailer | null>(null);
  const [settling, setSettling] = useState(false);
  // Leaving for the player: the page's content goes dark in turn (as under a trailer), then the black hand-over.
  const [leaving, setLeaving] = useState(false);
  const leaveThen = (action: () => void) => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => {
      if (!fadeThrough(action)) action();
    }, 560);
  };
  // `settling` is raised in the same breath as `expanded`: the transitions only run if their class is already on
  // when the page changes (set a frame later, the text would just vanish).
  const collapseTrailer = useCallback(() => {
    setSettling(true);
    setExpanded(false);
  }, []);
  useEffect(() => {
    if (!settling) return;
    const t = window.setTimeout(() => setSettling(false), 1300);
    return () => window.clearTimeout(t);
  }, [settling, expanded]);
  // The page stands still under a grown trailer.
  useEffect(() => {
    if (!expanded) return;
    const body = document.querySelector<HTMLElement>(".app-body");
    if (!body) return;
    const was = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = was;
    };
  }, [expanded]);

  // The trailer is about to play: the background music is already fading while it is being found.
  useEffect(() => (trailerResolving ? holdMusic() : undefined), [trailerResolving]);
  const [genreIds, setGenreIds] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const warn = (what: string) => (e: unknown) => console.warn(`[kp ${what}]`, e);
    // The card already carries everything the header shows; only fetch the full record
    // when it doesn't (e.g. no description) — saves time and the 500/day API quota.
    if (!preview?.description) {
      kpFilm(id)
        .then((f) => !cancelled && setFilm((prev) => ({ ...prev, ...f })))
        .catch((e) => !cancelled && !preview && setError(e instanceof Error ? e.message : String(e)));
    }
    kpImages(id, "STILL", 1).then((r) => !cancelled && setImages(r.items ?? [])).catch(warn("images"));
    kpStaff(id)
      .then((r) => !cancelled && setStaff(r))
      .catch(warn("staff"));
    kpSimilars(id)
      .then((r) => !cancelled && setSimilars(r.items ?? []))
      .catch(warn("similars"));
    return () => {
      cancelled = true;
    };
  }, [id, preview]);

  // Resolves a genre chip's name to the numeric id `kpFilmsFilter` needs — fetched once
  // (cached on both the Rust and JS side) rather than hardcoding the id list here.
  useEffect(() => {
    let cancelled = false;
    kpGenres()
      .then((r) => !cancelled && setGenreIds(new Map(r.genres.map((g) => [normalizeGenre(g.genre), g.id]))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const openGenre = (name: string) => {
    const id = genreIds?.get(normalizeGenre(name));
    if (id == null) return;
    navigate({
      name: "genre",
      kind: "films",
      title: name.charAt(0).toUpperCase() + name.slice(1),
      filter: { kind: "ALL", genre: id, ratingFrom: 0 },
    });
  };

  // Warm the first few full-size stills while the viewer is still closed, so opening one (and the
  // first flips) don't wait on the download. Sequential — it must not crowd out the page itself.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const im of images.slice(0, 3)) {
        if (cancelled) return;
        await preloadImage(img(stillLarge(im.imageUrl)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [images]);

  // The page scrolls like the home page: the picture drifts slower, the sheet with the shelves rises over it.
  useHomeFeel(film);

  // The picker shows the speed each release needs (size ÷ runtime), and runtime is only in
  // the full record — one cached request, and only if the viewer actually wants to watch.
  const [quality, setQuality] = useState<QualityKey | undefined>(undefined);
  const openWatch = () => {
    rememberImdbId();
    setQuality(undefined);
    setModal("watch");
    if (film?.filmLength) return;
    kpFilm(id)
      .then((f) => setFilm((prev) => ({ ...prev, filmLength: f.filmLength })))
      .catch(() => undefined);
  };

  // Saving the film to disk: pick a release (and an episode), then a folder, then it is in the list of downloads.
  const openDownload = () => {
    setModal("download");
    if (film?.filmLength) return;
    kpFilm(id)
      .then((f) => setFilm((prev) => ({ ...prev, filmLength: f.filmLength })))
      .catch(() => undefined);
  };
  const startDownload = async (pick: { link: string; hash: string; name: string; file: TorrentFile; multi: boolean }) => {
    const dir = await pickDownloadDir();
    if (!dir) return;
    setModal(null);
    const filmTitle = film?.nameRu || film?.nameOriginal || pick.name;
    await enqueueDownload({
      filmId: id,
      title: pick.multi ? `${filmTitle} · ${pick.file.name}` : filmTitle,
      poster: film?.posterUrlPreview ?? film?.posterUrl,
      film: { nameRu: film?.nameRu, nameOriginal: film?.nameOriginal, year: film?.year, genres: film?.genres?.map((g) => g.genre) },
      link: pick.link,
      fileId: pick.file.id,
      filePath: pick.file.path,
      dir,
    });
    navigate({ name: "downloads" });
  };

  // Trailers / legal sources are only needed if the viewer asks — fetched on demand.
  const openTrailers = () => {
    setModal("trailer");
    if (trailers) return;
    const rutube: Link = { key: "rutube", title: "Найти трейлер на Rutube", hint: "RUTUBE", url: RUTUBE_AUTO };
    kpVideos(id)
      .then((r) => {
        const found = (r.items ?? []).map((v, i) => ({ key: String(i), title: v.name || "Трейлер", hint: v.site, url: v.url }));
        // Always offered, and first: a YouTube link may be blocked, and TMDB often lists none.
        setTrailers([rutube, ...found]);
      })
      .catch(() => setTrailers([rutube]));
  };
  const growTrailer = () => {
    setSettling(true);
    cancelGlides();
    document.querySelector(".app-body")?.scrollTo({ top: 0, behavior: "instant" });
    setExpanded(true);
  };
  const isFav = useFavorites((s) => s.items.some((f) => f.kinopoiskId === id));
  const toggleFavorite = useFavorites((s) => s.toggle);
  const lastRelease = useLastRelease((s) => s.items[id]);

  if (!film) {
    return (
      <FocusGroup focusKey="movie" className="screen-pad home home--tv home--nohero mtv">
        <HomeChrome id="movie" />
        {error ? (
          <EmptyState error icon={<OfflineIcon size={38} strokeWidth={1.6} />} title="Не удалось загрузить фильм" hint={error} />
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
            <Spinner />
          </div>
        )}
      </FocusGroup>
    );
  }

  const title = film.nameRu || film.nameOriginal || "Без названия";
  const year = typeof film.year === "number" ? film.year : Number.parseInt(String(film.year ?? ""), 10) || undefined;
  const premiere = premiereOf(film);
  // No exact premiere date on record for most titles (Kinopoisk doesn't expose one on
  // every film) — a same-year comparison alone missed this: a Dec-2026 release with
  // "year: 2026" isn't > the current year 2026, so it read as already out. Nobody has
  // rated a film that hasn't released yet, so "no rating AND this year or later" is a
  // much better proxy than the year alone — a real released title from this year has
  // had time to pick up at least some votes by the time anyone's looking at its page.
  const hasRating = film.ratingKinopoisk != null && film.ratingKinopoisk > 0;
  const isUpcoming = premiere ? premiere.getTime() > Date.now() : !hasRating && year != null && year >= new Date().getFullYear();
  const releaseLabel = premiere ? `Премьера: ${formatPremiere(premiere)}` : year ? `Ожидается в ${year} году` : "Дата выхода неизвестна";
  // The frame across the whole window: the film's first still at its original size.
  const slides = images
    .slice(0, 8)
    .map((im) => ({ src: img(im.imageUrl) ?? "", preview: img(im.previewUrl) }))
    .filter((sl) => sl.src);
  const actors = staff.filter((p) => p.professionKey === "ACTOR").slice(0, 20);
  const cast = actors.slice(0, 3).map((p) => p.nameRu || p.nameEn).filter(Boolean);
  const director = staff.find((p) => p.professionKey === "DIRECTOR");
  const directorName = director?.nameRu || director?.nameEn;
  const genreNames = (film.genres ?? []).map((g) => g.genre);
  // Saved or started: remember the film's IMDb id, so a later switch of the source finds exactly this film.
  const rememberImdbId = () => void captureImdb(useApp.getState().metadataSource ?? "kinopoisk", id);
  const onToggleFavorite = () => {
    rememberImdbId();
    toggleFavorite({
      kinopoiskId: id,
      nameRu: film.nameRu,
      nameOriginal: film.nameOriginal,
      year: film.year,
      posterUrl: film.posterUrl,
      posterUrlPreview: film.posterUrlPreview,
      ratingKinopoisk: film.ratingKinopoisk,
      genres: film.genres,
    });
  };

  return (
    <FocusGroup focusKey="movie" className={`screen-pad home home--tv home--nohero mtv ${expanded ? "is-trailer" : ""} ${settling ? "is-trailer-fx" : ""} ${leaving ? "is-leaving" : ""}`}>
      <HomeChrome id="movie" />

      {/* The first screen: a frame of the film across the whole window, the title and what to do with it
          at the lower left, who is in it at the lower right. */}
      <div className="mtv__hero">
        <MovieBackdrop
          id={id}
          film={film}
          slides={slides}
          fallback={<ProgressiveImg className="mtv__backdrop mtv__backdrop--poster" src={img(film.posterUrl)} placeholder={img(film.posterUrlPreview)} alt={title} />}
          expanded={expanded}
          chosen={chosen}
          onLive={setTrailerLive}
          onCollapse={collapseTrailer}
          onList={openTrailers}
        />
        <div className="mtv__shade" />

        <div className="mtv__info">
          <h1 className="mtv__title">{title}</h1>
          <div className="mtv__meta">{["Фильм", ...(film.genres?.map((g) => g.genre).slice(0, 3) ?? [])].join(" · ")}</div>
          <p className="mtv__desc">{film.description || "Описание пока не добавлено."}</p>
          <div className="mtv__facts">
            {year != null && <span>{year}</span>}
            {film.filmLength ? <span>{formatLength(film.filmLength)}</span> : null}
            {film.ratingKinopoisk != null && film.ratingKinopoisk > 0 && <span className="mtv__rating">★ {film.ratingKinopoisk.toFixed(1)}</span>}
          </div>
          <FocusGroup focusKey="movie:actions" className="mtv__actions" preferredChildFocusKey={isUpcoming ? "movie:trailer" : "movie:watch"}>
            {isUpcoming ? (
              <>
                <span className="mtv__release">{releaseLabel}</span>
                <Focusable as="button" focusKey="movie:trailer" className="hero__btn hero__btn--pill" onPress={trailerLive ? growTrailer : openTrailers} autoFocus scroll={false} onFocus={toTop}>
                  Трейлер
                </Focusable>
              </>
            ) : (
              <>
                <Focusable as="button" focusKey="movie:watch" className="hero__btn hero__btn--pill mtv__primary" onPress={openWatch} autoFocus scroll={false} onFocus={toTop}>
                  <PlayIcon size={20} />
                  {continueLabel(id) ?? "Смотреть"}
                </Focusable>
                <Focusable as="button" focusKey="movie:trailer" className="hero__btn hero__btn--pill" onPress={trailerLive ? growTrailer : openTrailers} scroll={false} onFocus={toTop}>
                  Трейлер
                </Focusable>
                <Focusable as="button" focusKey="movie:quality" className="hero__btn hero__btn--pill" onPress={() => setModal("quality")} scroll={false} onFocus={toTop}>
                  Качество
                </Focusable>
              </>
            )}
            <Focusable
              as="button"
              focusKey="movie:download"
              className="hero__btn hero__btn--round"
              aria-label="Скачать на диск"
              onPress={openDownload}
              scroll={false}
              onFocus={toTop}
            >
              <DownloadIcon size={24} />
            </Focusable>
            <Focusable
              as="button"
              focusKey="movie:favorite"
              className={`hero__btn hero__btn--round ${isFav ? "is-on" : ""}`}
              onPress={onToggleFavorite}
              scroll={false}
              onFocus={toTop}
            >
              {isFav ? <FavoriteIcon key="on" size={24} fill="currentColor" /> : <PlusIcon size={26} />}
            </Focusable>
          </FocusGroup>
        </div>

        {(cast.length > 0 || directorName) && (
          <div className="mtv__credits">
            {cast.length > 0 && (
              <p>
                В главных ролях <b>{cast.join(", ")}</b>
              </p>
            )}
            {directorName && (
              <p>
                Режиссёр <b>{directorName}</b>
              </p>
            )}
          </div>
        )}
      </div>

      {/* The sheet: it rises over the picture as the page scrolls; the title and the first shelf peek out below it. */}
      <div className="mtv__sheet">
        <div className="mtv__sheet-bg" />
        <h2 className="mtv__sheet-title">{title}</h2>
        <div className="mtv__rows">
          <RowScroll label="Трейлеры" count={1}>
            <Focusable focusKey="trailers:0" className="mtv-trailer" onPress={openTrailers}>
              <ProgressiveImg src={img(stillCard(images[0]?.imageUrl ?? ""))} placeholder={img(images[0]?.previewUrl) ?? img(film.posterUrlPreview)} />
              <span className="mtv-trailer__play" aria-hidden="true">
                <PlayIcon size={34} />
              </span>
              <span className="mtv-trailer__label">{title}: трейлер</span>
            </Focusable>
          </RowScroll>

          <RowScroll label="Скриншоты" count={images.length}>
            {images.map((image, i) => (
              <Focusable
                key={image.previewUrl + i}
                focusKey={`stills:${i}`}
                className={`still-card mtv-trailer ${stillOpen === i ? "is-opened" : ""}`}
                onPress={() => setStillOpen(i)}
              >
                <ProgressiveImg src={img(stillCard(image.imageUrl))} placeholder={img(image.previewUrl)} />
                <span className="mtv-trailer__play" aria-hidden="true">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M16.5 16.5L21 21" />
                  </svg>
                </span>
                <span className="mtv-trailer__label">Скриншот {i + 1}</span>
              </Focusable>
            ))}
          </RowScroll>

          <RowScroll label="Актёры" count={actors.length}>
            {actors.map((p, i) => (
              <ActorTile key={p.staffId} person={p} focusKey={`actors:${i}`} onPress={() => navigate({ name: "person", id: p.staffId, preview: p })} />
            ))}
          </RowScroll>

          <RowScroll label="Жанры" count={genreNames.length}>
            {genreNames.map((name, i) => (
              <Focusable key={name} as="button" focusKey={`movie:genre:${i}`} className="mtv-genre" onPress={() => openGenre(name)}>
                {name}
              </Focusable>
            ))}
          </RowScroll>

          <RowScroll label="Похожие фильмы" count={similars.length}>
            {similars.map((s, i) => (
              <MovieCard
                key={s.filmId}
                film={{ kinopoiskId: s.filmId, nameRu: s.nameRu, nameOriginal: s.nameOriginal, posterUrl: s.posterUrl, posterUrlPreview: s.posterUrlPreview }}
                focusKey={`similar:${i}`}
                onPress={() => navigate({ name: "movie", id: s.filmId })}
              />
            ))}
          </RowScroll>
        </div>
      </div>

      {stillOpen !== null && images.length > 0 && (
        <Lightbox
          images={images.map((im) => ({ full: img(stillLarge(im.imageUrl)), preview: img(im.previewUrl) }))}
          index={Math.min(stillOpen, images.length - 1)}
          // The viewer grows out of (and shrinks back into) the card of the frame it is on.
          getOrigin={(i) => document.querySelectorAll(".still-card")[i]?.getBoundingClientRect() ?? null}
          onIndex={setStillOpen}
          onClose={() => {
            const closed = stillOpen;
            setStillOpen(null);
            // Focus lived in the viewer; put it back on the still that was open.
            // RESTORE_DETAILS: put focus back without scrolling the page (a plain focus re-centred the
            // card's row and the page jumped ~150 px after closing the viewer).
            requestAnimationFrame(() => setFocus(`stills:${closed}`, RESTORE_DETAILS));
          }}
        />
      )}
      {modal === "quality" && (
        <LinksModal
          tv
          heading="Качество"
          empty=""
          links={QUALITY_OPTIONS.map((o) => ({ key: o.key, title: o.title, hint: o.hint, url: "" }))}
          onClose={() => setModal(null)}
          onSelect={(l) => {
            // Straight into the search: the best release of this resolution starts by itself.
            openWatch();
            setQuality(l.key as QualityKey);
          }}
        />
      )}
      {modal === "download" && (
        <ReleasePickerModal
          filmId={id}
          title={title}
          year={year}
          durationMin={film.filmLength}
          download
          onDownload={(pick) => void startDownload(pick)}
          onClose={() => setModal(null)}
          onReady={() => undefined}
        />
      )}
      {modal === "watch" && (
        <ReleasePickerModal
          filmId={id}
          title={title}
          year={year}
          durationMin={film.filmLength}
          quality={quality}
          remembered={quality ? undefined : lastRelease}
          onClose={() => setModal(null)}
          onReady={(source) => {
            setModal(null);
            leaveThen(() =>
              navigate({
                name: "player",
                title: source.title,
                url: source.url,
                hash: source.hash,
                filmId: id,
                film: { nameRu: film.nameRu, nameOriginal: film.nameOriginal, year: film.year, genres: film.genres?.map((g) => g.genre) },
                poster: film.posterUrlPreview ? img(film.posterUrlPreview) : undefined,
                episodes: source.episodes,
                extras: source.extras,
              }),
            );
          }}
        />
      )}
      {modal === "trailer" && (
        <LinksModal
          tv
          heading="Трейлеры"
          empty="Трейлеры не найдены"
          onClose={() => setModal(null)}
          links={trailers}
          onSelect={(l) => {
            setModal(null);
            const viaRutube = l.url === RUTUBE_AUTO;
            if (!viaRutube && !isYoutubeUrl(l.url)) {
              // Kinopoisk's own widget player — embed it full-screen instead of the
              // mpv player, since yt-dlp/mpv can't play it (it's not a media file).
              fadeThrough(() => navigate({ name: "web-trailer", title: `${title} — ${l.title}`, url: l.url }));
              return;
            }
            setTrailerError(null);
            setTrailerResolving(true);
            resolveTrailerUrl(viaRutube ? "" : l.url, film)
              .then(async (r) => {
                const t = await makeTrailer(r);
                if (!t) throw new Error("yt-dlp не вернул ни одной ссылки на видео");
                setChosen(t);
                growTrailer();
              })
              .catch((e) => setTrailerError({ message: e instanceof Error ? e.message : String(e),
                url: viaRutube
                  ? `https://rutube.ru/search/?query=${encodeURIComponent(`${title} ${film.year ?? ""} трейлер`)}`
                  : l.url,
              }))
              .finally(() => setTrailerResolving(false));
          }}
        />
      )}
      {trailerResolving &&
        // Into <body> for the same reason as Modal.tsx: inside the animated screen wrapper
        // `position: fixed` is measured against that transformed box, not the window.
        createPortal(
          <div className="trailer-resolving">
            <div className="trailer-resolving__card">
              <Spinner />
              <p>Открываю трейлер…</p>
            </div>
          </div>,
          document.body,
        )}
      {trailerError && (
        <Modal focusKey="trailer-error" preferredChildFocusKey="trailer-err:browser" className="links-tv" onClose={() => setTrailerError(null)}>
          <h3 className="links-tv__title">Не удалось открыть трейлер</h3>
          <p className="links-tv__text">{trailerError.message}</p>
          <div className="links-tv__list">
            <Focusable
              as="button"
              className="links-tv__row"
              focusKey="trailer-err:browser"
              autoFocus
              scroll={false}
              onPress={() => {
                void openExternal(trailerError.url);
                setTrailerError(null);
              }}
            >
              <span className="links-tv__name">Открыть в браузере</span>
              <NextIcon size={20} />
            </Focusable>
            <Focusable as="button" back className="links-tv__row links-tv__row--close" focusKey="trailer-err:close" scroll={false} onPress={() => setTrailerError(null)}>
              <span className="links-tv__name">Закрыть</span>
            </Focusable>
          </div>
        </Modal>
      )}
    </FocusGroup>
  );
}

function ActorTile({ person, focusKey, onPress }: { person: KpStaffPerson; focusKey: string; onPress: () => void }) {
  return (
    <Focusable focusKey={focusKey} className="actor-card" onPress={onPress}>
      <div className="actor-card__avatar">
        {person.posterUrl && <img src={img(person.posterUrl)} alt="" loading="lazy" decoding="async" />}
        {/* Link mark over the focused photo — "opens the person's page" (actor-card__link in theme.css). */}
        <span className="actor-card__link" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path pathLength="1" d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path pathLength="1" d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </span>
      </div>
      <div className="actor-card__name">{person.nameRu || person.nameEn}</div>
      <div className="actor-card__role">{person.professionText}</div>
    </Focusable>
  );
}
