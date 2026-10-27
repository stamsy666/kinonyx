import { useCallback, useEffect, useRef, useState } from "react";
import { Focusable, FocusGroup, OfflineIcon, SearchIcon, Spinner } from "@kinonyx/ui";
import { EmptyState } from "../components/EmptyState";
import { useApp } from "../store/app";
import { kpFilmsFilter, type KpCollectionItem, type KpFilter } from "../data/api";
import { HomeChrome } from "../components/HomeChrome";
import { useHomeFeel } from "../components/useHomeFeel";
import { MovieCard } from "../components/MovieCard";
import { LazyShelf } from "../components/LazyShelf";
import { FocusHighlight } from "../components/FocusHighlight";

const thisYear = new Date().getFullYear();
const SHELVES: { title: string; text: string; variant: "posters" | "feature" | "banner"; filter: Partial<KpFilter> }[] = [
  { title: "Самое популярное", text: "Что чаще всего смотрят в этом жанре.", variant: "posters", filter: { order: "NUM_VOTE" } },
  { title: "Лучшее по рейтингу", text: "Самые высокие оценки зрителей.", variant: "feature", filter: { order: "RATING", ratingFrom: 7 } },
  { title: "Новинки", text: "Свежие фильмы жанра.", variant: "banner", filter: { order: "NUM_VOTE", yearFrom: thisYear - 1 } },
];

/** Full poster grid for one genre, opened from CategoriesScreen — paginated the same way
 *  as the LazyShelf placeholder fix: a trailing focusable tile gives keyboard/remote users
 *  somewhere to land so Down keeps loading pages, not just the mouse wheel. */
export function GenreScreen({ title, filter }: { title: string; filter: KpFilter }) {
  const navigate = useApp((s) => s.navigate);
  const [films, setFilms] = useState<KpCollectionItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useHomeFeel(null);

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
    <FocusGroup focusKey="genre" className="screen-pad home home--tv home--nohero">
      <HomeChrome id="genre" label={title} />
      <div className="home__rows">
        {/* What is worth a look in this genre, in the home page's looks — then everything of it below. */}
        {SHELVES.map((s, i) => (
          <LazyShelf
            key={s.title}
            title={s.title}
            text={s.text}
            load={() => kpFilmsFilter({ ...filter, ...s.filter }).then((r) => (r.items ?? []).filter((f) => f.posterUrlPreview))}
            focusPrefix={`genre-shelf${i}`}
            ranked={i === 0}
            limit={i === 0 ? 10 : undefined}
            variant={s.variant}
            autoFocusFirst={i === 0}
            onOpen={open}
          />
        ))}
        <div className="shelf__head genre__all">
          <h2 className="shelf__title">Все</h2>
        </div>
        {films.length === 0 && loading && (
          // Focusable (not a plain div): without it nothing is focused while the first
          // page is loading, so the initial remote/keyboard press lands on nothing.
          <Focusable focusKey="genre:loading" autoFocus scroll={false} style={{ display: "grid", placeItems: "center", height: 300 }}>
            <Spinner />
          </Focusable>
        )}
        {films.length === 0 && !loading && (failed ? <EmptyState error icon={<OfflineIcon size={38} strokeWidth={1.6} />} title="Не удалось загрузить подборку" hint="Проверьте подключение и попробуйте ещё раз." /> : <EmptyState icon={<SearchIcon size={38} strokeWidth={1.6} />} title="Ничего не найдено" />)}
        {films.length > 0 && (
          <div className="grid-cards">
            <FocusHighlight />
            {films.map((film, i) => (
              <MovieCard key={`${film.kinopoiskId}-${i}`} film={film} focusKey={`genre:${i}`} onPress={() => open(film)} />
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
