import { useEffect, useRef, useState } from "react";
import { BackIcon, Focusable, FocusGroup, Spinner } from "@kinonyx/ui";
import { SearchLensIcon } from "../components/AnimatedIcons";
import { useApp } from "../store/app";
import { kpFilm, kpPerson, type KpPerson, type KpPersonFilm, type KpStaffPerson } from "../data/api";
import { img } from "../data/images";
import { ProgressiveImg } from "../components/ProgressiveImg";
import { RowScroll } from "../components/RowScroll";
import { MovieCard } from "../components/MovieCard";
import { DetailBackButton } from "../components/DetailBackButton";

const FILMS_PER_VIEW = 5;

/** An actor/crew member's own page, opened from a film's "Актёры" row — photo, bio facts
 *  and every film they're credited on. Matches the user's sketch: static page title (not
 *  the person's name — that's in the body), profession/city above the name, then the
 *  filmography as a poster shelf like everywhere else in the app. */
export function PersonScreen({ id, preview }: { id: number; preview?: KpStaffPerson }) {
  const back = useApp((s) => s.back);
  const navigate = useApp((s) => s.navigate);
  const [person, setPerson] = useState<KpPerson | null>(
    preview ? { personId: preview.staffId, nameRu: preview.nameRu, nameEn: preview.nameEn, posterUrl: preview.posterUrl } : null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    kpPerson(id)
      .then((p) => !cancelled && setPerson(p))
      .catch((e) => !cancelled && !preview && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // See MovieScreen.tsx for why this is mode-dependent.
  const useFloatingBack = useApp((s) => s.inputMode) === "mouse";
  const onBackPress = () => back() || navigate({ name: "home" });
  const header = (
    <>
      {useFloatingBack && <DetailBackButton focusKey="person:back" onPress={onBackPress} autoFocus />}
      <header className="catalog__head">
        {useFloatingBack ? (
          <span />
        ) : (
          <Focusable back as="button" className="icon-btn" focusKey="person:back" onPress={onBackPress} scroll={false} autoFocus>
            <BackIcon />
          </Focusable>
        )}
        <h1 className="catalog__title">Информация об актере</h1>
        <Focusable as="button" className="icon-btn" focusKey="person:search" onPress={() => navigate({ name: "search" })} scrollBlock="start">
          <SearchLensIcon />
        </Focusable>
      </header>
    </>
  );

  if (!person) {
    return (
      <FocusGroup focusKey="person" className="catalog screen-pad">
        {header}
        {error ? (
          <p className="empty">Не удалось загрузить: {error}</p>
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: 300 }}>
            <Spinner />
          </div>
        )}
      </FocusGroup>
    );
  }

  const title = person.nameRu || person.nameEn || "Без имени";
  const metaParts = [person.profession, person.age != null ? `${person.age} лет` : undefined, person.birthplace].filter(Boolean);
  // Kinopoisk repeats a film once per department the person worked in (e.g. actor AND
  // producer on the same title) — one card per film, not per credit.
  const seenFilmIds = new Set<number>();
  const films = (person.films ?? []).filter((f) => {
    if (!(f.nameRu || f.nameEn) || seenFilmIds.has(f.filmId)) return false;
    seenFilmIds.add(f.filmId);
    return true;
  });
  const open = (filmId: number) => navigate({ name: "movie", id: filmId });

  return (
    <FocusGroup focusKey="person" className="catalog screen-pad">
      {header}

      <div className="movie-head">
        <div className="movie-head__poster">
          <ProgressiveImg src={img(person.posterUrl)} placeholder={img(preview?.posterUrl)} alt={title} />
        </div>
        <div className="movie-head__info">
          {metaParts.length > 0 && <p className="movie-head__category">{metaParts.join(" · ")}</p>}
          <h2 className="movie-head__title">{title}</h2>
          {person.facts?.map((f, i) => (
            <p key={i} className="person-facts">
              {f}
            </p>
          ))}
        </div>
      </div>

      <RowScroll label="Фильмография" count={films.length} perView={FILMS_PER_VIEW}>
        {films.map((f, i) => (
          <FilmographyCard key={`${f.filmId}-${i}`} film={f} focusKey={`person:film:${i}`} onPress={() => open(f.filmId)} />
        ))}
      </RowScroll>
    </FocusGroup>
  );
}

/** The person endpoint (`/api/v1/staff/{id}`) lists each film's title/year/rating but no
 *  poster — that lives only on the film's own record. Fetching all of them up front could
 *  mean dozens of extra requests for a long career, so each card asks for its poster only
 *  once it's actually scrolled into view (same IntersectionObserver approach as the lazy
 *  shelves elsewhere) — the default (viewport) root already accounts for the horizontal
 *  scroll clipping, so a card sitting off to the right of the row doesn't fire early.
 *  MovieCard itself falls back to the "no cover" placeholder when there's no URL or the
 *  URL 404s, so nothing extra to do here for that case. */
function FilmographyCard({ film, focusKey, autoFocus, onPress }: { film: KpPersonFilm; focusKey: string; autoFocus?: boolean; onPress: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [poster, setPoster] = useState<{ posterUrlPreview?: string; ratingKinopoisk?: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        kpFilm(film.filmId)
          .then((full) => setPoster({ posterUrlPreview: full.posterUrlPreview, ratingKinopoisk: full.ratingKinopoisk }))
          .catch(() => undefined);
      },
      { rootMargin: "0px 400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [film.filmId]);

  return (
    <div ref={ref} className="filmography-card">
      <MovieCard
        film={{
          kinopoiskId: film.filmId,
          nameRu: film.nameRu,
          nameOriginal: film.nameEn,
          year: film.year,
          posterUrlPreview: poster?.posterUrlPreview,
          ratingKinopoisk: poster?.ratingKinopoisk ?? (film.rating ? Number(film.rating) : undefined),
        }}
        focusKey={focusKey}
        autoFocus={autoFocus}
        onPress={onPress}
      />
    </div>
  );
}
