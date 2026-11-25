import { useEffect, useRef, useState } from "react";
import { FocusGroup, OfflineIcon, SearchIcon, Spinner } from "@kinonyx/ui";
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

/** Genre shelves followed by a poster grid that prefetches as the viewer approaches its end. */
export function GenreScreen({ title, filter }: { title: string; filter: KpFilter }) {
  const navigate = useApp((s) => s.navigate);
  const [films, setFilms] = useState<KpCollectionItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useHomeFeel(null);

  useEffect(() => {
    if (!loading) return;
    let cancelled = false;
    const next = page + 1;
    setFailed(false);
    kpFilmsFilter(filter, next)
      .then((res) => {
        if (cancelled) return;
        const items = (res.items ?? []).filter((f) => f.posterUrlPreview);
        setFilms((prev) => [...prev, ...items]);
        setPage(next);
        setHasMore(next < (res.totalPages ?? next));
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
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setLoading(true);
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, page]);

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
          <div role="status" aria-label="Загрузка фильмов" style={{ display: "grid", placeItems: "center", height: 300 }}>
            <Spinner />
          </div>
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
        <div ref={sentinelRef} aria-hidden />
        {films.length > 0 && loading && <div className="archive-panel__more" role="status">Загрузка…</div>}
      </div>
    </FocusGroup>
  );
}
