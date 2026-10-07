import { useEffect, useRef, useState } from "react";
import type { KpCollectionItem } from "../data/api";
import { Focusable, Spinner } from "@kinonyx/ui";
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
}

/**
 * A shelf that only asks for its films once it scrolls near the viewport. The free
 * Kinopoisk key allows 500 requests a day, and a catalog page has 8–9 shelves — most
 * visits never scroll to the bottom ones. Keeps its height reserved while empty so the
 * page doesn't jump as shelves fill in.
 */
export function LazyShelf({ title, text, load, focusPrefix, onOpen, perView, limit = 20, ranked, autoFocusFirst }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [films, setFilms] = useState<KpCollectionItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Arrow-key navigation only ever lands on elements that already exist — a shelf that
  // hasn't loaded yet has nothing to focus, so Down silently does nothing and the page
  // never scrolls (only the mouse wheel triggered IntersectionObserver before this fix).
  // Landing keyboard focus on the placeholder itself gives spatial-nav somewhere to go,
  // which starts the load and scrolls it into view; once it loads, focus jumps onto the
  // first card so the remote user keeps moving instead of getting stuck on a dead tile.
  const wantsFocusRef = useRef(false);

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

  if (failed || films?.length === 0) return null;

  return (
    <div ref={ref}>
      {!films && (
        <Focusable
          focusKey={`${focusPrefix}:placeholder`}
          className="shelf-placeholder"
          scroll
          // Without this, a page whose first shelf hasn't loaded yet (e.g. right after
          // navigating in from the sidebar) starts with nothing focused at all — no ring
          // anywhere, first key press does nothing, and it reads as "focus got lost".
          autoFocus={autoFocusFirst}
          onFocus={() => {
            wantsFocusRef.current = true;
            setNear(true);
          }}
        >
          {near && (
            <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
              <Spinner />
            </div>
          )}
        </Focusable>
      )}
      {films && (
        <RowScroll label={title} description={text} count={films.length} perView={perView}>
          {films.map((film, i) => (
            <MovieCard
              key={film.kinopoiskId}
              film={film}
              focusKey={`${focusPrefix}:${i}`}
              rank={ranked ? i + 1 : undefined}
              autoFocus={(autoFocusFirst || wantsFocusRef.current) && i === 0}
              onPress={() => onOpen(film)}
            />
          ))}
        </RowScroll>
      )}
    </div>
  );
}
