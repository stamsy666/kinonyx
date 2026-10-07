import { useEffect, useState } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { Focusable } from "@kinonyx/ui";
import { kpImages, type KpCollectionItem } from "../data/api";
import { img, stillLarge } from "../data/images";
import { ProgressiveImg } from "./ProgressiveImg";

const ROTATE_MS = 7000;

export function HeroCarousel({ films, onOpen }: { films: KpCollectionItem[]; onOpen: (film: KpCollectionItem) => void }) {
  const [index, setIndex] = useState(0);
  const slides = films.slice(0, 5);
  const ids = slides.map((f) => f.kinopoiskId).join(",");

  useEffect(() => {
    if (slides.length < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % slides.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [slides.length]);

  // A real frame from the film reads far better as ambience than the poster stretched
  // and blurred — the poster is portrait art, not a scene. One STILL image per slide,
  // fetched once and cached (same disk cache as every other Kinopoisk request); falls
  // back to the poster crop for the rare film with no stills. `/1920x` (not the ~280px
  // `previewUrl`) so it stays sharp stretched full-bleed across the banner — previewUrl
  // was visibly pixelated at that size.
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

  // Same slide-left/slide-right feel as the gallery/lightbox viewers (SlideViewer.tsx),
  // adapted to this carousel's existing render-all-slides-and-toggle-a-class approach
  // (it already cross-fades that way) instead of mount/unmount: every slide keeps a fixed
  // "which side of active" bucket, computed via shortest wrap-aware direction, so the
  // outgoing frame transitions out that side and the incoming one transitions in from it.
  const offsetOf = (i: number): "left" | "right" | null => {
    if (i === index) return null;
    const raw = (i - index + slides.length) % slides.length;
    return raw <= slides.length / 2 ? "right" : "left";
  };

  return (
    <Focusable
      focusKey="hero"
      className="hero"
      // Was `scroll={false}` — meant the hero never scrolled itself into view, so
      // navigating Up from a lower shelf moved focus onto it but left the page exactly
      // where it was, hero nowhere on screen. "start" pins it flush under the top bar,
      // which is what "perfectly visible at the top" means for the tallest element on
      // the page (a plain "center" would leave slack above/below it instead).
      scrollBlock="start"
      autoFocus
      onArrowPress={(direction) => {
        // Left/Right flip slides while the banner is focused; Down leaves it as usual.
        if (direction === "left" || direction === "right") {
          go(direction === "left" ? -1 : 1);
          return false;
        }
        // The hero spans the full width, so the default nearest-neighbour search often
        // fails to line it up with the narrow top-bar icons above it — Up would just do
        // nothing (focus stays put, nothing visibly changes). Send it there explicitly.
        if (direction === "up") {
          setFocus("hdr:search");
          return false;
        }
        return true;
      }}
      // onPress alone: Focusable already routes Enter to it — also passing onEnterPress
      // opened the film twice (and "back" then took two presses).
      onPress={() => onOpen(slides[index])}
    >
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
            <ProgressiveImg className="hero__backdrop" src={backdrop} placeholder={preview} alt="" />
            <ProgressiveImg className="hero__poster" src={img(film.posterUrl)} placeholder={preview} alt={title} />
            <div className="hero__info">
              <div className="hero__meta">
                {film.ratingKinopoisk != null && <span className="hero__rating">★ {film.ratingKinopoisk.toFixed(1)}</span>}
                <span className="hero__category">{film.genres?.map((g) => g.genre).join(" · ") || "Фильм"}</span>
              </div>
              <h2 className="hero__title">{title}</h2>
              {film.description && <p className="hero__desc">{film.description}</p>}
            </div>
          </div>
        );
      })}
      <button
        className="hero__arrow hero__arrow--prev"
        onClick={(e) => {
          e.stopPropagation();
          go(-1);
        }}
      >
        ‹
      </button>
      <button
        className="hero__arrow hero__arrow--next"
        onClick={(e) => {
          e.stopPropagation();
          go(1);
        }}
      >
        ›
      </button>
      <div className="hero__dots">
        {slides.map((film, i) => (
          <i key={film.kinopoiskId} className={`hero__dot ${i === index ? "is-active" : ""}`} />
        ))}
      </div>
    </Focusable>
  );
}
