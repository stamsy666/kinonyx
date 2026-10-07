import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BackIcon, FavoriteIcon, Focusable, FocusGroup, Spinner } from "@kinonyx/ui";
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
} from "../data/api";
import { img } from "../data/images";
import { openExternal } from "../data/io";
import { RowScroll } from "../components/RowScroll";
import { MovieCard } from "../components/MovieCard";
import { ReleasePickerModal } from "../components/ReleasePickerModal";
import { LinksModal, type Link } from "../components/LinksModal";
import { QUALITY_OPTIONS, type QualityKey } from "../data/quality";
import { continueLabel } from "../store/episodeProgress";
import { Modal } from "../components/Modal";
import { ProgressiveImg } from "../components/ProgressiveImg";
import { MovieBackdrop } from "../components/MovieBackdrop";
import { DetailBackButton } from "../components/DetailBackButton";

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

const STILLS_PER_VIEW = 4;
const ACTORS_PER_VIEW = 7;
const BACKDROP_SLIDES = 8;

type Modal = "watch" | "quality" | "trailer" | null;

// Kinopoisk's own videos list mixes real YouTube trailers with entries that just point
// at its own embeddable widget player (widgets.kinopoisk.ru/.../trailer/...) — those
// only work inside a browser frame on kinopoisk.ru itself, yt-dlp has no extractor for
// them, and mpv can't play them either. Only route the former into the app's own player.
function isYoutubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

/** Pseudo-entry in the trailer list: no YouTube link to open, search Rutube by name instead. */
const RUTUBE_AUTO = "rutube:auto";

const normalizeGenre = (s: string) => s.trim().toLowerCase();

export function MovieScreen({ id, preview }: { id: number; preview?: KpCollectionItem }) {
  const back = useApp((s) => s.back);
  const navigate = useApp((s) => s.navigate);
  const [film, setFilm] = useState<FilmView | null>(preview ?? null);
  const [images, setImages] = useState<KpImage[]>([]);
  const [staff, setStaff] = useState<KpStaffPerson[]>([]);
  const [similars, setSimilars] = useState<KpSimilarFilm[]>([]);
  const [trailers, setTrailers] = useState<Link[] | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState<string | null>(null);
  const [trailerResolving, setTrailerResolving] = useState(false);
  const [trailerError, setTrailerError] = useState<{ message: string; url: string } | null>(null);
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
      .then((r) => !cancelled && setStaff(r.filter((p) => p.professionKey === "ACTOR").slice(0, 20)))
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

  // The film's stills as the page's ambient backdrop; the poster until they arrive.
  const backdrop = useMemo(() => {
    const stills = images.slice(0, BACKDROP_SLIDES).map((i) => img(i.previewUrl)).filter((u): u is string => !!u);
    if (stills.length) return stills;
    const poster = img(film?.posterUrlPreview);
    return poster ? [poster] : [];
  }, [images, film?.posterUrlPreview]);

  // The picker shows the speed each release needs (size ÷ runtime), and runtime is only in
  // the full record — one cached request, and only if the viewer actually wants to watch.
  const [quality, setQuality] = useState<QualityKey | undefined>(undefined);
  const openWatch = () => {
    setQuality(undefined);
    setModal("watch");
    if (film?.filmLength) return;
    kpFilm(id)
      .then((f) => setFilm((prev) => ({ ...prev, filmLength: f.filmLength })))
      .catch(() => undefined);
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
  // Mouse has no hardware Back, so the button floats over the content on a detail page
  // this long; remote/keyboard already have one (onBack's Escape/Backspace) and get the
  // button back in its normal spot instead — see data/inputMode.ts.
  const useFloatingBack = useApp((s) => s.inputMode) === "mouse";
  const onBackPress = () => back() || navigate({ name: "home" });
  const backButton = useFloatingBack ? (
    <DetailBackButton focusKey="movie:back" onPress={onBackPress} autoFocus={!film} />
  ) : (
    <div className="row" style={{ marginTop: 4 }}>
      <Focusable as="button" className="icon-btn" focusKey="movie:back" onPress={onBackPress} scroll={false} autoFocus={!film}>
        <BackIcon />
      </Focusable>
    </div>
  );
  const isFav = useFavorites((s) => s.items.some((f) => f.kinopoiskId === id));
  const toggleFavorite = useFavorites((s) => s.toggle);
  const lastRelease = useLastRelease((s) => s.items[id]);

  if (!film) {
    return (
      <FocusGroup focusKey="movie" className="screen-pad stack" style={useFloatingBack ? { paddingTop: 76 } : undefined}>
        {backButton}
        {error ? (
          <p className="empty">Не удалось загрузить фильм: {error}</p>
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: 300 }}>
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
  const onToggleFavorite = () =>
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

  return (
    <FocusGroup focusKey="movie" className="screen-pad stack" style={useFloatingBack ? { paddingTop: 76 } : undefined}>
      <MovieBackdrop images={backdrop} />
      {backButton}

      <div className="movie-head">
        <div className="movie-head__poster">
          <ProgressiveImg src={img(film.posterUrl)} placeholder={img(film.posterUrlPreview)} alt={title} />
        </div>
        <div className="movie-head__info">
          <div className="movie-head__meta">
            {film.ratingKinopoisk != null && <span className="movie-head__rating">★ {film.ratingKinopoisk.toFixed(1)}</span>}
            <span className="movie-head__category">
              {film.genres && film.genres.length > 0
                ? film.genres.map((g, i) => (
                    <span key={g.genre + i}>
                      <Focusable
                        as="button"
                        className="genre-chip"
                        focusKey={`movie:genre:${i}`}
                        onPress={() => openGenre(g.genre)}
                        scroll={false}
                      >
                        {g.genre}
                      </Focusable>
                      {i < film.genres!.length - 1 ? " · " : ""}
                    </span>
                  ))
                : "Фильм"}
              {year ? ` · ${year}` : ""}
            </span>
          </div>
          <h1 className="movie-head__title">{title}</h1>
          <p className="movie-head__desc">{film.description || "Описание пока не добавлено."}</p>
          <div className="movie-head__actions">
            {isUpcoming ? (
              <>
                <span className="movie-head__release">{releaseLabel}</span>
                <Focusable as="button" focusKey="movie:trailer" className="btn" onPress={openTrailers} autoFocus scroll={false}>
                  Трейлер
                </Focusable>
              </>
            ) : (
              <>
                <Focusable as="button" focusKey="movie:watch" className="btn btn--primary" onPress={openWatch} autoFocus scroll={false}>
                  {continueLabel(id) ?? "Смотреть"}
                </Focusable>
                <Focusable as="button" focusKey="movie:quality" className="btn" onPress={() => setModal("quality")}>
                  Качество
                </Focusable>
                <Focusable as="button" focusKey="movie:trailer" className="btn" onPress={openTrailers}>
                  Трейлер
                </Focusable>
              </>
            )}
            <Focusable
              as="button"
              focusKey="movie:favorite"
              className={`icon-btn icon-btn--fav ${isFav ? "is-fav" : ""}`}
              onPress={onToggleFavorite}
              scroll={false}
            >
              <FavoriteIcon fill={isFav ? "currentColor" : "none"} />
            </Focusable>
          </div>
        </div>
      </div>

      <RowScroll label="Материалы" count={images.length} perView={STILLS_PER_VIEW}>
        {images.map((image, i) => (
          <Focusable
            key={image.previewUrl + i}
            focusKey={`stills:${i}`}
            className="still-card"
            onPress={() => navigate({ name: "gallery", filmId: id, startIndex: i })}
          >
            <img src={img(image.previewUrl)} alt="" loading="lazy" decoding="async" />
          </Focusable>
        ))}
      </RowScroll>

      <RowScroll label="Актёры" count={staff.length} perView={ACTORS_PER_VIEW}>
        {staff.map((p, i) => (
          <ActorTile key={p.staffId} person={p} focusKey={`actors:${i}`} onPress={() => navigate({ name: "person", id: p.staffId, preview: p })} />
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

      {modal === "quality" && (
        <LinksModal
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
      {modal === "watch" && (
        <ReleasePickerModal
          filmId={id}
          title={title}
          year={year}
          durationMin={film.filmLength}
          quality={quality}
          remembered={quality ? undefined : lastRelease}
          onClose={() => setModal(null)}
          onReady={(source) =>
            navigate({
              name: "player",
              title: source.title,
              url: source.url,
              hash: source.hash,
              filmId: id,
              film: { nameRu: film.nameRu, nameOriginal: film.nameOriginal, year: film.year, genres: film.genres?.map((g) => g.genre) },
              poster: film.posterUrlPreview ? img(film.posterUrlPreview) : undefined,
              episodes: source.episodes,
            })
          }
        />
      )}
      {modal === "trailer" && (
        <LinksModal
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
              navigate({ name: "web-trailer", title: `${title} — ${l.title}`, url: l.url });
              return;
            }
            setTrailerError(null);
            setTrailerResolving(true);
            resolveTrailerUrl(viaRutube ? "" : l.url, film)
              .then((r) =>
                navigate({
                  name: "player",
                  title: `${title} — ${l.title}`,
                  url: r.qualities[r.defaultIndex].url,
                  qualities: r.qualities,
                  qualityIndex: r.defaultIndex,
                }),
              )
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
        <Modal focusKey="trailer-error" preferredChildFocusKey="trailer-err:browser" onClose={() => setTrailerError(null)}>
          <div className="modal-panel__header">
            <h3>Не удалось открыть трейлер</h3>
            <Focusable
              as="button"
              className="icon-btn"
              focusKey="trailer-err:close"
              onPress={() => setTrailerError(null)}
              scroll={false}
            >
              ×
            </Focusable>
          </div>
          <p className="trailer-error__text">{trailerError.message}</p>
          <div className="trailer-error__actions">
            <Focusable
              as="button"
              className="btn btn--primary"
              focusKey="trailer-err:browser"
              autoFocus
              scroll={false}
              onPress={() => {
                void openExternal(trailerError.url);
                setTrailerError(null);
              }}
            >
              Открыть в браузере
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
      <div className="actor-card__avatar">{person.posterUrl && <img src={img(person.posterUrl)} alt="" loading="lazy" decoding="async" />}</div>
      <div className="actor-card__name">{person.nameRu || person.nameEn}</div>
      <div className="actor-card__role">{person.professionText}</div>
    </Focusable>
  );
}
