import { useEffect, useRef, useState } from "react";
import type { KpCollectionItem } from "../data/api";
import { getCurrentFocusKey, setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { Focusable, Spinner } from "@kinonyx/ui";
import { CollectionBanner, FeatureCard } from "./HomeBlocks";
import { RowScroll } from "./RowScroll";
import { MovieCard } from "./MovieCard";

interface Props {
  title: string;
  text?: string;
  load: () => Promise<KpCollectionItem[]>;
  focusPrefix: string;
  onOpen: (film: KpCollectionItem) => void;
  perView?: number;
  limit?: number;
  ranked?: boolean;
  /** Give the first card focus once loaded (first shelf of a page, for remote users). */
  autoFocusFirst?: boolean;
  /** How the shelf looks: posters (default), big featured cards, or a wide banner over a row of posters. */
  variant?: "posters" | "feature" | "banner";
}

/**
 * A shelf that only asks for its films once it scrolls near the viewport. The free
 * Kinopoisk key allows 500 requests a day, and a catalog page has 8–9 shelves — most
 * visits never scroll to the bottom ones. Keeps its height reserved while empty so the
 * page doesn't jump as shelves fill in.
 */
export function LazyShelf({ title, text, load, focusPrefix, onOpen, perView, limit = 20, ranked, autoFocusFirst, variant = "posters" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [films, setFilms] = useState<KpCollectionItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [placeholderFocused, setPlaceholderFocused] = useState(false);
  const placeholderKey = `${focusPrefix}:placeholder`;
  const unavailable = failed || films?.length === 0;

  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      rootMargin: "600px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    load()
      .then((items) => !cancelled && setFilms(items.filter((f) => f.posterUrlPreview).slice(0, limit)))
      .catch((e) => {
        console.warn(`[shelf ${title}]`, e);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // `load` is a fresh closure every render; the shelf identity is its title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, title]);

  useEffect(() => {
    // A delayed response may arrive after the viewer already moved to another row.
    if (films?.length && getCurrentFocusKey() === placeholderKey) {
      setFocus(`${focusPrefix}:0`, { restore: true });
    }
  }, [films, focusPrefix, placeholderKey]);

  if (unavailable && !placeholderFocused) return null;

  return (
    <div ref={ref}>
      {(!films || unavailable) && (
        <Focusable
          focusKey={placeholderKey}
          className="shelf-placeholder"
          scroll
          // Without this, a page whose first shelf hasn't loaded yet (e.g. right after
          // navigating in from the sidebar) starts with nothing focused at all — no ring
          // anywhere, first key press does nothing, and it reads as "focus got lost".
          autoFocus={autoFocusFirst}
          onFocus={() => {
            setPlaceholderFocused(true);
            setNear(true);
          }}
          onBlur={() => setPlaceholderFocused(false)}
        >
          {near && (
            <div role="status" style={{ display: "grid", placeItems: "center", height: "100%" }}>
              {failed ? "Не удалось загрузить подборку" : unavailable ? "Подборка пуста" : <Spinner />}
            </div>
          )}
        </Focusable>
      )}
      {films && !unavailable && variant === "feature" && (
        <RowScroll label={title} count={films.length} className="shelf--feature">
          {films.slice(0, 10).map((film, i) => (
            <FeatureCard
              key={film.kinopoiskId}
              film={film}
              focusKey={`${focusPrefix}:${i}`}
              onPress={() => onOpen(film)}
            />
          ))}
        </RowScroll>
      )}
      {films && !unavailable && variant === "banner" && (
        <section className="shelf shelf--banner">
          <CollectionBanner
            film={films[0]}
            title={title}
            text={text}
            focusKey={`${focusPrefix}:banner`}
            onPress={() => setFocus(`${focusPrefix}:0`)}
          />
        </section>
      )}
      {films && !unavailable && variant !== "feature" && (
        <RowScroll
          label={title}
          description={text}
          count={films.length}
          perView={perView}
          className={variant === "banner" ? "shelf--under-banner" : ""}
        >
          {films.map((film, i) => (
            <MovieCard
              key={film.kinopoiskId}
              film={film}
              focusKey={`${focusPrefix}:${i}`}
              rank={ranked ? i + 1 : undefined}
              onPress={() => onOpen(film)}
            />
          ))}
        </RowScroll>
      )}
    </div>
  );
}
