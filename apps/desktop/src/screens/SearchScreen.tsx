import { useEffect, useRef, useState } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { BackIcon, Focusable, FocusGroup, MicIcon, SearchIcon, Spinner } from "@kinonyx/ui";
import { useApp } from "../store/app";
import {
  kpCollection,
  kpFilmsFilter,
  kpGenres,
  kpSearch,
  KP_COLLECTIONS,
  type KpCollectionItem,
  type KpGenreDef,
} from "../data/api";
import {
  applyFilters,
  hasActiveFilters,
  nextStep,
  RATING_STEPS,
  readFilters,
  toKpFilter,
  writeFilters,
  YEAR_STEPS,
  DEFAULT_FILTERS,
  type SearchFilters,
  type SearchKind,
} from "../data/searchFilters";
import { useSearchHistory } from "../store/searchHistory";
import { LinksModal, type Link } from "../components/LinksModal";
import { TextField } from "../components/TextField";
import { MovieCard } from "../components/MovieCard";
import { FocusHighlight } from "../components/FocusHighlight";
import { SoonModal } from "../components/SoonModal";

const DEBOUNCE_MS = 450;

const KIND_OPTIONS: { key: SearchKind; label: string }[] = [
  { key: "ALL", label: "Всё" },
  { key: "FILM", label: "Фильмы" },
  { key: "TV_SERIES", label: "Сериалы" },
];

export function SearchScreen() {
  const back = useApp((s) => s.back);
  const navigate = useApp((s) => s.navigate);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KpCollectionItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  // Enter is usually pressed the instant typing stops — well before the 450ms debounce
  // even starts the request, let alone finishes it. Focusing "search:0" right away hit a
  // focusKey that didn't exist yet, and the library dropped focus entirely instead of a
  // safe no-op — "пульт как будто отключился". This waits for results and focuses the
  // first one once they're actually there, instead of assuming they already are.
  const wantsResultFocus = useRef(false);
  const [voiceSoon, setVoiceSoon] = useState(false);
  // Shown before the viewer types anything at all — an empty screen with just a text
  // field read as broken ("with zero letters, at least show some releases").
  const [defaultFilms, setDefaultFilms] = useState<KpCollectionItem[] | null>(null);
  const [filters, setFilters] = useState<SearchFilters>(readFilters);
  const [filtered, setFiltered] = useState<KpCollectionItem[] | null>(null);
  const [genres, setGenres] = useState<KpGenreDef[] | null>(null);
  const [genreModal, setGenreModal] = useState(false);
  const history = useSearchHistory((s) => s.items);
  const active = hasActiveFilters(filters);
  const update = (patch: Partial<SearchFilters>) =>
    setFilters((f) => {
      const next = { ...f, ...patch };
      writeFilters(next);
      return next;
    });

  useEffect(() => {
    kpCollection(KP_COLLECTIONS.popular, 1)
      .then((r) => setDefaultFilms(r.items ?? []))
      .catch(() => setDefaultFilms([]));
  }, []);

  // No text: the filters themselves are the query (server-side, paginated by the source).
  useEffect(() => {
    if (!active) {
      setFiltered(null);
      return;
    }
    let cancelled = false;
    setFiltered(null);
    kpFilmsFilter(toKpFilter(filters))
      .then((r) => !cancelled && setFiltered(r.items ?? []))
      .catch(() => !cancelled && setFiltered([]));
    return () => {
      cancelled = true;
    };
  }, [filters, active]);

  const openGenres = () => {
    setGenreModal(true);
    if (!genres) {
      kpGenres()
        .then((r) => setGenres(r.genres ?? []))
        .catch(() => setGenres([]));
    }
  };

  useEffect(() => {
    const q = query.trim();
    // A single letter used to be silently ignored (the threshold was 2) — one keystroke
    // already narrows Kinopoisk's own search-by-keyword usefully, no reason to wait.
    if (q.length < 1) {
      setResults(null);
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      kpSearch(q)
        .then((films) => {
          if (id !== requestId.current) return;
          setResults(films);
          setError(null);
        })
        .catch((e) => {
          if (id !== requestId.current) return;
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (wantsResultFocus.current && results && results.length > 0) {
      wantsResultFocus.current = false;
      setFocus("search:0");
    }
  }, [results]);

  const isSearching = query.trim().length > 0;
  const shown = isSearching ? (results ? applyFilters(results, filters) : null) : active ? filtered : defaultFilms;
  const filtersLoading = !isSearching && active && filtered === null;

  return (
    <FocusGroup focusKey="search" className="screen-pad stack">
      <div className="row" style={{ marginTop: 4 }}>
        <Focusable
          as="button"
          className="icon-btn"
          focusKey="search:back"
          onPress={() => back() || navigate({ name: "home" })}
          scroll={false}
        >
          <BackIcon />
        </Focusable>
        <TextField
          focusKey="search:field"
          className="field--grow"
          value={query}
          onChange={setQuery}
          placeholder="Название фильма или сериала"
          type="search"
          icon={<SearchIcon size={20} />}
          autoFocus
          editOnMount
          onSubmit={() => {
            useSearchHistory.getState().add(query);
            if (results && results.length > 0) setFocus("search:0");
            else wantsResultFocus.current = true;
          }}
        />
        <Focusable
          as="button"
          className="icon-btn"
          focusKey="search:voice"
          onPress={() => setVoiceSoon(true)}
          scroll={false}
        >
          <MicIcon />
        </Focusable>
      </div>

      <div className="search-filters">
        <FocusHighlight pad={5} radius={16} />
        {KIND_OPTIONS.map((o, i) => (
          <Focusable
            as="button"
            key={o.key}
            focusKey={`search:kind:${i}`}
            className={`sound-option ${filters.kind === o.key ? "is-active" : ""}`}
            onPress={() => update({ kind: o.key })}
          >
            {o.label}
          </Focusable>
        ))}
        <Focusable
          as="button"
          focusKey="search:genre"
          className={`sound-option ${filters.genre ? "is-active" : ""}`}
          onPress={openGenres}
        >
          Жанр: {filters.genre?.name ?? "любой"}
        </Focusable>
        <Focusable
          as="button"
          focusKey="search:year"
          className={`sound-option ${filters.yearFrom ? "is-active" : ""}`}
          onPress={() => update({ yearFrom: nextStep(YEAR_STEPS, filters.yearFrom) })}
        >
          Год: {filters.yearFrom ? `с ${filters.yearFrom}` : "любой"}
        </Focusable>
        <Focusable
          as="button"
          focusKey="search:rating"
          className={`sound-option ${filters.ratingFrom ? "is-active" : ""}`}
          onPress={() => update({ ratingFrom: nextStep(RATING_STEPS, filters.ratingFrom) })}
        >
          Рейтинг: {filters.ratingFrom ? `${filters.ratingFrom}+` : "любой"}
        </Focusable>
        {active && (
          <Focusable
            as="button"
            focusKey="search:reset"
            className="sound-option"
            onPress={() => {
              writeFilters(DEFAULT_FILTERS);
              setFilters(DEFAULT_FILTERS);
            }}
          >
            Сбросить
          </Focusable>
        )}
      </div>

      {!isSearching && !active && history.length > 0 && (
        <div className="search-history">
          <span className="search-history__label">Недавнее</span>
          {history.map((q, i) => (
            <Focusable
              as="button"
              key={q}
              focusKey={`search:history:${i}`}
              className="sound-option"
              onPress={() => setQuery(q)}
            >
              {q}
            </Focusable>
          ))}
          <Focusable
            as="button"
            focusKey="search:history-clear"
            className="sound-option search-history__clear"
            onPress={() => useSearchHistory.getState().clear()}
          >
            Очистить
          </Focusable>
        </div>
      )}

      {(loading || filtersLoading) && (
        <div style={{ display: "grid", placeItems: "center", height: 200 }}>
          <Spinner />
        </div>
      )}
      {error && <p className="empty">Поиск не удался: {error}</p>}
      {!loading && isSearching && shown && shown.length === 0 && (
        <p className="empty">{results && results.length > 0 ? "Ничего не подошло под фильтры" : "Ничего не найдено"}</p>
      )}
      {!filtersLoading && !isSearching && active && filtered?.length === 0 && (
        <p className="empty">Ничего не нашлось — ослабьте фильтры</p>
      )}
      {!isSearching && shown && shown.length > 0 && (
        <p className="section-label">{active ? "По фильтрам" : "Популярное сейчас"}</p>
      )}
      {!loading && !filtersLoading && shown && shown.length > 0 && (
        <div className="grid-cards">
          <FocusHighlight />
          {shown.map((film, i) => (
            <MovieCard
              key={film.kinopoiskId}
              film={film}
              focusKey={`search:${i}`}
              onPress={() => {
                useSearchHistory.getState().add(query);
                navigate({ name: "movie", id: film.kinopoiskId, preview: film });
              }}
            />
          ))}
        </div>
      )}
      {genreModal && (
        <LinksModal
          heading="Жанр"
          empty="Жанры не загрузились"
          onClose={() => setGenreModal(false)}
          links={
            genres &&
            ([{ key: "any", title: "Любой жанр", url: "" }, ...genres.map((g) => ({ key: String(g.id), title: g.genre, url: String(g.id) }))] as Link[])
          }
          onSelect={(l) => {
            setGenreModal(false);
            update({ genre: l.key === "any" ? undefined : { id: Number(l.url), name: l.title } });
          }}
        />
      )}
      {voiceSoon && <SoonModal text="Голосовой поиск ещё в разработке." onClose={() => setVoiceSoon(false)} />}
    </FocusGroup>
  );
}
