import { useEffect, useRef, useState } from "react";
import { FocusContext, getCurrentFocusKey, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { Focusable, FocusGroup, MicIcon, OfflineIcon, SearchIcon, Spinner } from "@kinonyx/ui";
import { EmptyState } from "../components/EmptyState";
import { useApp } from "../store/app";
import { kpSearch, type KpCollectionItem } from "../data/api";
import { useSearchHistory } from "../store/searchHistory";
import { playCategorySound } from "../data/sounds";
import { MovieCard } from "../components/MovieCard";
import { HomeChrome } from "../components/HomeChrome";
import { CategoryGroups } from "../components/CategoryBrowse";
import { useHomeFeel } from "../components/useHomeFeel";
import { returnedToSavedFocus } from "../data/focusRestore";
import { SearchKeys, type SearchKeyMode } from "../components/SearchKeys";
import { VoiceSearchModal } from "../components/VoiceSearchModal";
import { applyRemoteTextEdit } from "../data/remote";

const DEBOUNCE_MS = 450;

/** What was typed, kept while a film is open: coming back with "Назад" finds the same results (and the focus
 *  and the scroll put back on the film left from), a fresh opening starts empty. */
const kept = { query: "", mode: "ru" as SearchKeyMode };

/** Поиск, after the tvOS search page: the keyboard on the left, what to look at (the genres, or the results)
 *  on the right. Moving right off the keyboard slides it away and gives the whole width to the right side. */
export function SearchScreen() {
  const navigate = useApp((s) => s.navigate);
  // Reached by "Назад" from a film: the search is as it was left.
  const comingBack = useRef(returnedToSavedFocus()).current;
  const [query, setQuery] = useState(() => (comingBack ? kept.query : ""));
  const [mode, setMode] = useState<SearchKeyMode>(() => (comingBack ? kept.mode : "ru"));
  kept.query = query;
  kept.mode = mode;
  const [results, setResults] = useState<KpCollectionItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  // Enter is usually pressed the instant typing stops — well before the debounce even starts the request.
  // This waits for results and focuses the first one once they're actually there.
  const wantsResultFocus = useRef(false);
  // Whether the letters came from a real keyboard. Only then does Enter mean "show me the first result": with a
  // remote Enter is the OK button, and pressing it on an on-screen key must just type that letter.
  const typedOnKeyboard = useRef(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const history = useSearchHistory((s) => s.items);
  useHomeFeel(null);
  // The right side is its own focus group: while the focus is in it the keyboard slides out of the way.
  const side = useFocusable<HTMLDivElement>({ focusKey: "search:side", trackChildren: true, saveLastFocusedChild: true });
  const wide = side.hasFocusedChild;
  // The keyboard never scrolls the page: back on it, the page returns to the top.
  const firstTop = useRef(true);
  useEffect(() => {
    const first = firstTop.current;
    firstTop.current = false;
    if (first && comingBack) return; // the page is being put back where it was left
    if (!wide) document.querySelector(".app-body")?.scrollTo({ top: 0, behavior: "smooth" });
  }, [wide]);
  const kbd = useFocusable<HTMLDivElement>({ focusKey: "search:kbd", trackChildren: true, saveLastFocusedChild: true });

  // Right off the keyboard's last column goes to the right side, Left off the side's first column comes back to the
  // keyboard (the nearest-neighbour search would pick the buttons at the top instead).
  useEffect(() => {
    const onArrow = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (document.querySelector(".modal, [role=dialog]")) return;
      // Down from the top bar: the menu button to the keyboard, the other two to the right side.
      if (e.key === "ArrowDown") {
        const key = document.querySelector<HTMLElement>(".is-focused[data-fk]")?.dataset.fk;
        const target = key === "home:menu" ? "search:kbd" : key === "search:voice" || key === "search:fullscreen" ? "search:side" : null;
        if (target) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setFocus(target);
        }
        return;
      }
      const el = document.querySelector<HTMLElement>(".sx .is-focused");
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Up from the top row of either half goes to the top bar (menu on the left, the microphone on the right).
      if (e.key === "ArrowUp") {
        const top = el.closest(".sx__modes") ? "home:menu" : el.closest(".sx__side") && r.top <= el.closest(".sx__side")!.getBoundingClientRect().top + 40 ? "search:voice" : null;
        if (!top) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        setFocus(top);
        return;
      }
      if (e.key === "ArrowRight" && el.closest(".sx__kbd")) {
        const edge = el.closest(".sx__kbd")!.getBoundingClientRect().right;
        if (r.right < edge - 12) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        setFocus("search:side");
      } else if (e.key === "ArrowLeft" && el.closest(".sx__side")) {
        const edge = el.closest(".sx__side")!.getBoundingClientRect().left;
        if (r.left > edge + r.width * 0.5 + 20) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        setFocus("search:kbd");
      }
    };
    window.addEventListener("keydown", onArrow, true);
    return () => window.removeEventListener("keydown", onArrow, true);
  }, []);

  useEffect(() => {
    const q = query.trim();
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

  // A real keyboard types too: letters go into the query, Backspace deletes (only while there is something to
  // delete — an empty field leaves Backspace to "go back"), Enter takes the first result.
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => {
    const submit = () => {
      if (!queryRef.current.trim()) return;
      useSearchHistory.getState().add(queryRef.current);
      wantsResultFocus.current = true;
      setResults((r) => (r ? [...r] : r));
    };
    const onRemoteEdit = (e: WindowEventMap["kinonyx:remote-edit"]) => {
      if (document.querySelector(".modal, [role=dialog]") || !getCurrentFocusKey()?.startsWith("search:")) return;
      if (e.detail.submit) return submit();
      typedOnKeyboard.current = true;
      playCategorySound("typing");
      setQuery((value) => applyRemoteTextEdit(value, e.detail).value);
    };
    window.addEventListener("kinonyx:remote-edit", onRemoteEdit);
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".modal, [role=dialog]")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.startsWith("Arrow")) typedOnKeyboard.current = false; // moving about with the remote
      if (e.key === "Backspace" && queryRef.current) {
        typedOnKeyboard.current = true;
        e.preventDefault();
        e.stopImmediatePropagation();
        playCategorySound("typing");
        setQuery((q) => q.slice(0, -1));
      } else if (e.key.length === 1) {
        typedOnKeyboard.current = true;
        e.preventDefault();
        e.stopImmediatePropagation();
        playCategorySound("typing");
        setQuery((q) => q + e.key);
      } else if (e.key === "Enter" && typedOnKeyboard.current) {
        submit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("kinonyx:remote-edit", onRemoteEdit);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  const type = (ch: string) => {
    typedOnKeyboard.current = false;
    playCategorySound("typing");
    setQuery((q) => q + ch);
  };

  const isSearching = query.trim().length > 0;
  const shown = isSearching ? results : null;
  const browsing = !isSearching;

  return (
    <FocusGroup focusKey="search" className="screen-pad home home--tv home--nohero sx-page">
      <HomeChrome
        id="search"
        label="Поиск"
        hideSearch
        extra={
          <Focusable as="button" className="home-round" focusKey="search:voice" scroll={false} onPress={() => setVoiceOpen(true)}>
            <MicIcon />
          </Focusable>
        }
      />

      <div className="sx" data-wide={wide ? "true" : "false"}>
        <div className="sx__field">
          <SearchIcon size={44} />
          <span className={`sx__query ${query ? "" : "is-placeholder"}`}>
            {query || "Фильмы, сериалы, актёры и др."}
            {query && <i className="sx__caret" />}
          </span>
        </div>
        <div className="sx__rule" />

        <div className="sx__cols">
          <FocusContext.Provider value={kbd.focusKey}>
          <div ref={kbd.ref} className="sx__kbd">
            <SearchKeys prefix="search" mode={mode} onModeChange={setMode} autoFocus={!comingBack}
              onType={type}
              onErase={() => {
                playCategorySound("typing");
                setQuery((q) => q.slice(0, -1));
              }}
              onClear={() => setQuery("")}
            />
          </div>
          </FocusContext.Provider>

          <FocusContext.Provider value={side.focusKey}>
            <div ref={side.ref} className="sx__side">
              {browsing && history.length > 0 && (
                <div className="sx__chips sx__history">
                  <span className="sx__label">Недавнее</span>
                  {history.map((q, i) => (
                    <Focusable as="button" key={q} focusKey={`search:history:${i}`} className="sx__chip" onPress={() => setQuery(q)}>
                      {q}
                    </Focusable>
                  ))}
                  <Focusable as="button" focusKey="search:history-clear" className="sx__chip" onPress={() => useSearchHistory.getState().clear()}>
                    Очистить
                  </Focusable>
                </div>
              )}

              {loading && (
                <div style={{ display: "grid", placeItems: "center", height: 200 }}>
                  <Spinner />
                </div>
              )}
              {error && <EmptyState error icon={<OfflineIcon size={38} strokeWidth={1.6} />} title="Поиск не удался" hint={error} />}
              {!loading && isSearching && shown && shown.length === 0 && <EmptyState icon={<SearchIcon size={38} strokeWidth={1.6} />} title="Ничего не найдено" hint="Попробуйте другое название или уберите фильтры." />}

              {browsing ? (
                <div className="cats sx__browse">
                  <CategoryGroups prefix="search:cat" />
                </div>
              ) : (
                !loading &&
                shown &&
                shown.length > 0 && (
                  <>
                    <p className="sx__label">Результаты</p>
                    <div className="grid-cards sx__grid">
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
                  </>
                )
              )}
            </div>
          </FocusContext.Provider>
        </div>
      </div>

      {voiceOpen && (
        <VoiceSearchModal
          onClose={() => setVoiceOpen(false)}
          onResult={(text) => {
            setVoiceOpen(false);
            setQuery(text);
            useSearchHistory.getState().add(text);
          }}
        />
      )}
    </FocusGroup>
  );
}
