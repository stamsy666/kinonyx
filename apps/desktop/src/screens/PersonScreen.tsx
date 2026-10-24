import { useEffect, useRef, useState } from "react";
import { FocusGroup, Spinner } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { kpFilm, kpPerson, type KpPerson, type KpPersonFilm, type KpStaffPerson } from "../data/api";
import { img } from "../data/images";
import { ProgressiveImg } from "../components/ProgressiveImg";
import { RowScroll } from "../components/RowScroll";
import { MovieCard } from "../components/MovieCard";
import { HomeChrome } from "../components/HomeChrome";
import { useHomeFeel } from "../components/useHomeFeel";

/** Text from the sources sometimes carries emoji (trophies, flags, stars) — they have no place on the page. */
const clean = (text: string) =>
  text
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u20E3]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();

/** An actor/crew member's own page, opened from a film's "Актёры" row — photo, bio facts
 *  and every film they're credited on. Matches the user's sketch: static page title (not
 *  the person's name — that's in the body), profession/city above the name, then the
 *  filmography as a poster shelf like everywhere else in the app. */
export function PersonScreen({ id, preview }: { id: number; preview?: KpStaffPerson }) {
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

  useHomeFeel(person);
  // The first film takes the focus on arrival without moving the page (the top of it — photo and name — stays in view).
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setArrived(true), 600);
    return () => window.clearTimeout(t);
  }, []);

  if (!person) {
    return (
      <FocusGroup focusKey="person" className="screen-pad home home--tv home--nohero ptv">
        <HomeChrome id="person" label="Актёр" />
        {error ? (
          <p className="empty" style={{ paddingTop: 140 }}>Не удалось загрузить: {error}</p>
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
            <Spinner />
          </div>
        )}
      </FocusGroup>
    );
  }

  const title = clean(person.nameRu || person.nameEn || "") || "Без имени";
  const metaParts = [person.profession, person.age != null ? `${person.age} лет` : undefined, person.birthplace].filter((x): x is string => !!x).map(clean).filter(Boolean);
  const facts = (person.facts ?? []).map(clean).filter(Boolean).slice(0, 5);
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
    <FocusGroup focusKey="person" className="screen-pad home home--tv home--nohero ptv">
      <HomeChrome id="person" label="Актёр" />

      <div className="ptv__top">
        <div className="ptv__photo">
          <ProgressiveImg src={img(person.posterUrl)} placeholder={img(preview?.posterUrl)} alt={title} />
        </div>
        <div className="ptv__info">
          {metaParts.length > 0 && <p className="ptv__meta">{metaParts.join(" · ")}</p>}
          <h1 className="ptv__name">{title}</h1>
          {facts.length > 0 && (
            <div className="ptv__facts">
              {facts.map((f, i) => (
                <p key={i}>{f}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      <RowScroll label="Фильмография" count={films.length}>
        {films.map((f, i) => (
          <FilmographyCard key={`${f.filmId}-${i}`} film={f} focusKey={`person:film:${i}`} autoFocus={i === 0} scroll={i === 0 ? arrived : undefined} onPress={() => open(f.filmId)} />
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
function FilmographyCard({ film, focusKey, autoFocus, scroll, onPress }: { film: KpPersonFilm; focusKey: string; autoFocus?: boolean; scroll?: boolean; onPress: () => void }) {
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
        scroll={scroll}
        onPress={onPress}
      />
    </div>
  );
}
