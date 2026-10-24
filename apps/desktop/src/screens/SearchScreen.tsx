import { useEffect, useRef, useState } from "react";
import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { Focusable, FocusGroup, GlobeIcon, MicIcon, SearchIcon, Spinner } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { kpSearch, type KpCollectionItem } from "../data/api";
import { useSearchHistory } from "../store/searchHistory";
import { playCategorySound } from "../data/sounds";
import { MovieCard } from "../components/MovieCard";
import { HomeChrome } from "../components/HomeChrome";
import { CategoryGroups } from "../components/CategoryBrowse";
import { useHomeFeel } from "../components/useHomeFeel";
import { VoiceSearchModal } from "../components/VoiceSearchModal";

const DEBOUNCE_MS = 450;

/** The on-screen keyboard (six keys a row, like the tvOS one). */
type Mode = "ru" | "en" | "sym";
const KEYS: Record<Mode, string[]> = {
  ru: "абвгдеёжзийклмнопрстуфхцчшщъыьэюя".split(""),
  en: "abcdefghijklmnopqrstuvwxyz".split(""),
  sym: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "`", "'", '"', ";", ":", "~", "=", "*", "+", "-", "_", ",", ".", "?", "!", "@", "#", "₽", "%", "^", "&", "|", "/", "\\", "(", ")", "[", "]", "{", "}", "<", ">"],
};
const MODE_LABEL: Record<Mode, string> = { ru: "абв", en: "abc", sym: "123" };

/** Поиск, after the tvOS search page: the keyboard on the left, what to look at (the genres, or the results)
 *  on the right. Moving right off the keyboard slides it away and gives the whole width to the right side. */
export function SearchScreen() {
  const navigate = useApp((s) => s.navigate);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("ru");
  const [results, setResults] = useState<KpCollectionItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  // Enter is usually pressed the instant typing stops — well before the debounce even starts the request.
  // This waits for results and focuses the first one once they're actually there.
  const wantsResultFocus = useRef(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const history = useSearchHistory((s) => s.items);
  useHomeFeel(null);
  // The right side is its own focus group: while the focus is in it the keyboard slides out of the way.
  const side = useFocusable<HTMLDivElement>({ focusKey: "search:side", trackChildren: true, saveLastFocusedChild: true });
  const wide = side.hasFocusedChild;
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
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".modal, [role=dialog]")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Backspace" && queryRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        playCategorySound("typing");
        setQuery((q) => q.slice(0, -1));
      } else if (e.key.length === 1) {
        e.preventDefault();
        e.stopImmediatePropagation();
        playCategorySound("typing");
        setQuery((q) => q + e.key);
      } else if (e.key === "Enter" && queryRef.current.trim()) {
        useSearchHistory.getState().add(queryRef.current);
        wantsResultFocus.current = true;
        setResults((r) => (r ? [...r] : r)); // re-run the "focus the first result" effect if results are already in
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const type = (ch: string) => {
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
            <div className="sx__modes">
              <Focusable
                as="button"
                className="sx__mode sx__mode--globe"
                focusKey="search:lang"
                autoFocus
                onPress={() => setMode((m) => (m === "ru" ? "en" : "ru"))}
              >
                <GlobeIcon size={26} />
              </Focusable>
              <Focusable as="button" className={`sx__mode ${mode !== "sym" ? "is-active" : ""}`} focusKey="search:letters" onPress={() => setMode((m) => (m === "sym" ? "ru" : m))}>
                {MODE_LABEL[mode === "sym" ? "ru" : mode]}
              </Focusable>
              <Focusable as="button" className={`sx__mode ${mode === "sym" ? "is-active" : ""}`} focusKey="search:symbols" onPress={() => setMode("sym")}>
                123
              </Focusable>
            </div>
            <div className="sx__keys">
              {KEYS[mode].map((k, i) => (
                <Focusable key={`${mode}:${k}`} as="button" className="sx__key" focusKey={`search:key:${i}`} mute onPress={() => type(k)}>
                  {k}
                </Focusable>
              ))}
            </div>
            <div className="sx__actions">
              <Focusable as="button" className="sx__action" focusKey="search:space" mute onPress={() => type(" ")}>
                ПРОБЕЛ
              </Focusable>
              <Focusable
                as="button"
                className="sx__action sx__action--icon"
                focusKey="search:erase"
                mute
                onPress={() => {
                  playCategorySound("typing");
                  setQuery((q) => q.slice(0, -1));
                }}
              >
                <svg width="30" height="24" viewBox="0 0 30 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H10L2 12z" />
                  <path d="M16 8l8 8M24 8l-8 8" />
                </svg>
              </Focusable>
              <Focusable as="button" className="sx__action" focusKey="search:clear" onPress={() => setQuery("")}>
                ОЧИСТИТЬ
              </Focusable>
            </div>
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
              {error && <p className="empty">Поиск не удался: {error}</p>}
              {!loading && isSearching && shown && shown.length === 0 && <p className="empty">Ничего не найдено</p>}

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
