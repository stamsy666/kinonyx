import { useEffect, useState } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { returnedToSavedFocus } from "../data/focusRestore";
import { cancelGlides, FavoriteIcon, Focusable, FocusGroup, NextIcon, PlusIcon } from "@kinonyx/ui";
import { kpImages, type KpCollectionItem } from "../data/api";
import { img, stillLarge } from "../data/images";
import { useFavorites } from "../store/favorites";
import { ProgressiveImg } from "./ProgressiveImg";

const ROTATE_MS = 7000;

/** The page goes back to its top when the banner gets the focus: it is meant to be seen whole. */
const toTop = () => {
  cancelGlides();
  document.querySelector(".app-body")?.scrollTo({ top: 0, behavior: "smooth" });
};

/**
 * The home banner, laid out like the Apple TV store's: a frame of the film across the whole width,
 * the title, a line about it and a few buttons at the lower left, and a pill of dots at the bottom.
 * The buttons carry the focus — "Подробнее" opens the film, "+" adds it to the favourites, "›" turns
 * to the next one; Left on "Подробнее" turns back.
 */
export function HeroCarousel({ films, onOpen }: { films: KpCollectionItem[]; onOpen: (film: KpCollectionItem) => void }) {
  const [index, setIndex] = useState(0);
  const slides = films.slice(0, 5);
  const ids = slides.map((f) => f.kinopoiskId).join(",");
  const favorites = useFavorites((s) => s.items);
  const toggleFavorite = useFavorites((s) => s.toggle);

  // Turning by itself; pressing anything restarts the wait, so a slide never changes right under a press.
  useEffect(() => {
    if (slides.length < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % slides.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [slides.length, index]);

  // A real frame from the film reads far better as the backdrop than the poster stretched and
  // blurred — the poster is portrait art, not a scene. One STILL image per slide, fetched once and
  // cached (same disk cache as every other Kinopoisk request); falls back to the poster for the
  // rare film with no stills. `/1920x` so it stays sharp across the whole width.
  const [stills, setStills] = useState<Record<number, string | undefined>>({});
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      slides.map((f) =>
        kpImages(f.kinopoiskId, "STILL", 1)
          .then((r) => [f.kinopoiskId, r.items?.[0]?.imageUrl] as const)
          .catch(() => [f.kinopoiskId, undefined] as const),
      ),
    ).then((pairs) => {
      if (!cancelled) setStills(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  if (slides.length === 0) return null;
  const go = (delta: number) => setIndex((i) => (i + delta + slides.length) % slides.length);
  const current = slides[index];
  const isFavorite = favorites.some((f) => f.kinopoiskId === current.kinopoiskId);

  // Slide-left/slide-right like the gallery viewers: every slide keeps a fixed "which side of
  // active" bucket (shortest wrap-aware direction), so the outgoing frame leaves that side and the
  // incoming one arrives from it.
  const offsetOf = (i: number): "left" | "right" | null => {
    if (i === index) return null;
    const raw = (i - index + slides.length) % slides.length;
    return raw <= slides.length / 2 ? "right" : "left";
  };

  // Up from any button goes to the menu chip at the top left (the nearest-neighbour search would miss it).
  const common = (extra?: (dir: string) => boolean | void) => (direction: string) => {
    if (direction === "up") {
      setFocus("home:menu");
      return false;
    }
    return extra?.(direction) ?? true;
  };

  return (
    <div className="hero">
      {slides.map((film, i) => {
        const title = film.nameRu || film.nameOriginal || "Без названия";
        const preview = img(film.posterUrlPreview);
        const stillUrl = stills[film.kinopoiskId];
        const backdrop = stillUrl ? img(stillLarge(stillUrl)) : preview;
        const offset = offsetOf(i);
        return (
          <div
            key={film.kinopoiskId}
            className={`hero__slide ${i === index ? "is-active" : ""} ${offset ? `hero__slide--offset-${offset}` : ""}`}
          >
            <ProgressiveImg className="hero__backdrop" src={backdrop} placeholder={preview} alt={title} />
            <div className="hero__info">
              <h2 className="hero__title">{title}</h2>
              <div className="hero__meta">
                <span className="hero__category">
                  {["Фильм", ...(film.genres?.map((g) => g.genre).slice(0, 2) ?? [])].join(" · ")}
                </span>
                {film.year != null && <span className="hero__year">{film.year}</span>}
                {film.ratingKinopoisk != null && <span className="hero__rating">★ {film.ratingKinopoisk.toFixed(1)}</span>}
              </div>
              {film.description && <p className="hero__desc">{film.description}</p>}
            </div>
          </div>
        );
      })}

      {/* The buttons are their own group: the banner reaches under the first row, so measured as a
          whole it would not count as "above" it, and Up from the row would miss the buttons. */}
      <FocusGroup focusKey="hero" className="hero__actions" preferredChildFocusKey="hero:details">
        <Focusable
          as="button"
          className="hero__btn hero__btn--pill"
          focusKey="hero:details"
          autoFocus={!returnedToSavedFocus()}
          scroll={false}
          onFocus={toTop}
          onArrowPress={common((dir) => {
            if (dir === "left") {
              go(-1);
              return false;
            }
          })}
          onPress={() => onOpen(current)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          Подробнее
        </Focusable>
        <Focusable
          as="button"
          className={`hero__btn hero__btn--round ${isFavorite ? "is-on" : ""}`}
          focusKey="hero:add"
          scroll={false}
          onFocus={toTop}
          onArrowPress={common()}
          onPress={() => toggleFavorite(current)}
        >
          {isFavorite ? <FavoriteIcon size={24} /> : <PlusIcon size={26} />}
        </Focusable>
        <Focusable
          as="button"
          className="hero__btn hero__btn--round"
          focusKey="hero:next"
          scroll={false}
          onFocus={toTop}
          onArrowPress={common()}
          onPress={() => go(1)}
        >
          <NextIcon size={26} />
        </Focusable>
      </FocusGroup>

      <div className="hero__dots">
        {slides.map((film, i) => (
          <i key={film.kinopoiskId} className={`hero__dot ${i === index ? "is-active" : ""}`} />
        ))}
      </div>
    </div>
  );
}
