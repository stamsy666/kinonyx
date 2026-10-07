import { useCallback, useEffect, useRef, useState } from "react";
import { Focusable, FocusGroup, Spinner } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { kpFilmsFilter, type KpCollectionItem, type KpFilter } from "../data/api";
import { TvScreenHeader } from "../components/TvScreenHeader";
import { MovieCard } from "../components/MovieCard";
import { FocusHighlight } from "../components/FocusHighlight";

/** Full poster grid for one genre, opened from CategoriesScreen — paginated the same way
 *  as the LazyShelf placeholder fix: a trailing focusable tile gives keyboard/remote users
 *  somewhere to land so Down keeps loading pages, not just the mouse wheel. */
export function GenreScreen({ title, filter }: { title: string; filter: KpFilter }) {
  const navigate = useApp((s) => s.navigate);
  const back = useApp((s) => s.back);
  const [films, setFilms] = useState<KpCollectionItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(() => {
    setLoading((already) => {
      if (already) return already;
      return true;
    });
  }, []);

  // Kick the actual request from an effect keyed on `loading` so overlapping triggers
  // (focus + IntersectionObserver firing close together) only ever cause one request.
  useEffect(() => {
    if (!loading) return;
    let cancelled = false;
    const next = page + 1;
    kpFilmsFilter(filter, next)
      .then((res) => {
        if (cancelled) return;
        const items = (res.items ?? []).filter((f) => f.posterUrlPreview);
        setFilms((prev) => [...prev, ...items]);
        setPage(next);
        setHasMore(items.length > 0 && next < (res.totalPages ?? next));
      })
      .catch((e) => {
        console.warn("[genre]", e);
        if (!cancelled) setFailed(true);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  const open = (film: KpCollectionItem) => navigate({ name: "movie", id: film.kinopoiskId, preview: film });

  return (
    <FocusGroup focusKey="genre" className="screen">
      <TvScreenHeader title={title} onBack={() => back()} onSettings={() => navigate({ name: "settings" })} />
      <div className="screen__body">
        {films.length === 0 && loading && (
          // Focusable (not a plain div): without it nothing is focused while the first
          // page is loading, so the initial remote/keyboard press lands on nothing.
          <Focusable focusKey="genre:loading" autoFocus scroll={false} style={{ display: "grid", placeItems: "center", height: 300 }}>
            <Spinner />
          </Focusable>
        )}
        {films.length === 0 && !loading && (failed ? <p className="empty">Не удалось загрузить подборку.</p> : <p className="empty">Ничего не найдено.</p>)}
        {films.length > 0 && (
          <div className="grid-cards">
            <FocusHighlight />
            {films.map((film, i) => (
              <MovieCard key={`${film.kinopoiskId}-${i}`} film={film} focusKey={`genre:${i}`} autoFocus={i === 0} onPress={() => open(film)} />
            ))}
          </div>
        )}
        {hasMore && !failed && (
          <Focusable focusKey="genre:more" className="archive-panel__more" scroll onFocus={loadMore}>
            {loading ? "Загрузка…" : "Ещё"}
          </Focusable>
        )}
        <div ref={sentinelRef} />
      </div>
    </FocusGroup>
  );
}
