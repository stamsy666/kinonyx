import { useEffect, useRef, useState } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { createPortal } from "react-dom";
import { CategoriesIcon, Focusable, FocusGroup, OfflineIcon, SearchIcon, Spinner, cancelGlides, onBack } from "@kinonyx/ui";
import { AdultActors } from "../components/AdultActors";
import { EmptyState } from "../components/EmptyState";
import { FocusHighlight } from "../components/FocusHighlight";
import { HomeChrome } from "../components/HomeChrome";
import { Modal } from "../components/Modal";
import { TextField } from "../components/TextField";
import { useHomeFeel } from "../components/useHomeFeel";
import { useApp } from "../store/app";
import { adultCategories, adultList, adultPerformers, type AdultCategory, type AdultPerformer, type AdultVideo } from "../data/api";
import { adultConfirmed, adultFocused, adultStreams, confirmAdult } from "../data/adult";
import { img } from "../data/images";
import noPoster from "../assets/no-poster.jpg";

/** A person, drawn like the other line icons of the app. */
function ActorsIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </svg>
  );
}

/** Asked once: the section is opt-in, so nothing is loaded before the viewer says they are an adult. */
function AgeGate({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <Modal focusKey="adult:gate" preferredChildFocusKey="adult:gate:yes" className="links-tv" onClose={onNo}>
      <h3 className="links-tv__title">Только для взрослых</h3>
      <p className="links-tv__text">В разделе материалы 18+. Продолжайте, только если вам исполнилось 18 лет и это разрешено там, где вы находитесь.</p>
      <div className="links-tv__list">
        <Focusable as="button" className="links-tv__row links-tv__row--primary" focusKey="adult:gate:yes" autoFocus scroll={false} onPress={onYes}>
          <span className="links-tv__name">Мне есть 18 лет</span>
        </Focusable>
        <Focusable as="button" back className="links-tv__row links-tv__row--close" focusKey="adult:gate:no" scroll={false} onPress={onNo}>
          <span className="links-tv__name">Назад</span>
        </Focusable>
      </div>
    </Modal>
  );
}

function VideoCard({ video, focusKey, onPress }: { video: AdultVideo; focusKey: string; onPress: () => void }) {
  // A picture that fails is asked for again (a refusal in a burst of requests is usually over a moment later); only when
  // it keeps failing does the card show the placeholder.
  const [attempt, setAttempt] = useState(0);
  const [gone, setGone] = useState(false);
  const onError = () => {
    if (attempt < 2) window.setTimeout(() => setAttempt((n) => n + 1), 1200 * (attempt + 1));
    else setGone(true);
  };
  return (
    <Focusable focusKey={focusKey} className="movie-card movie-card--wide" onPress={onPress} onFocus={() => adultFocused(video.key)}>
      <div className="movie-card__poster">
        <img key={attempt} src={gone ? noPoster : img(video.thumb)} alt={video.title} loading="lazy" decoding="async" onError={onError} />
        <span className="movie-card__play" aria-hidden="true">
          <svg width="64" height="64" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 6l10 6l-10 6Z" />
          </svg>
        </span>
        {video.duration && <span className="movie-card__label">{video.duration}</span>}
      </div>
      <div className="movie-card__title">{video.title}</div>
      <div className="movie-card__meta">{video.views ? `${video.views} просмотров` : ""}</div>
    </Focusable>
  );
}

/** The page numbers the bar shows: the first, the last and the five around the current one, "gap" for what is skipped. */
function pageItems(page: number, count: number): (number | "gap")[] {
  const shown = [...new Set([1, count, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= count))].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  let previous = 0;
  for (const n of shown) {
    if (n - previous > 1) out.push("gap");
    out.push(n);
    previous = n;
  }
  return out;
}

/** "Для взрослых" — opened from the Categories page. A search and a button for the site's categories, a poster grid of one
 *  page of the list with the page numbers under it, and the player for what is picked. */
export function AdultScreen() {
  const navigate = useApp((s) => s.navigate);
  const back = useApp((s) => s.back);
  const [confirmed, setConfirmed] = useState(adultConfirmed);
  const [query, setQuery] = useState("");
  // The site is asked once the typing pauses, not for every letter.
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(query.trim()), 450);
    return () => window.clearTimeout(t);
  }, [query]);
  // One category of the site narrows the lists; the picker shows every category as a tile.
  const [category, setCategory] = useState<AdultCategory | undefined>();
  const [categories, setCategories] = useState<AdultCategory[] | null>(null);
  // The picker that replaces the page: the site's categories, or its actors.
  const [picking, setPicking] = useState<"categories" | "actors" | null>(null);
  // Typing a name also looks for the model with that name; picking an actress lists her own videos.
  const [performer, setPerformer] = useState<AdultPerformer | undefined>();
  const [performers, setPerformers] = useState<AdultPerformer[]>([]);
  const [videos, setVideos] = useState<AdultVideo[]>([]);
  // The site's own pages, one at a time (30–50 videos), numbered at the bottom: the screen never holds more than a page.
  // The page belongs to the list it was chosen in, so a new search, category or actress starts again from the first.
  const listKey = `${search}|${category?.slug ?? ""}|${performer?.path ?? ""}`;
  const [paged, setPaged] = useState({ key: listKey, page: 1 });
  const page = paged.key === listKey ? paged.page : 1;
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // After a page is picked in the bar, the focus goes to the first card of the new one (the page itself scrolls to the top).
  const refocus = useRef(false);
  useHomeFeel(null);

  // The search, the categories button and the chip are the top of the page: reaching them (going up from the grid) shows the
  // whole page top with its header, not just enough to see the control itself (which is where a plain focus scroll stops).
  const toTop = () => {
    cancelGlides();
    document.querySelector(".app-body")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goTo = (n: number) => {
    refocus.current = true;
    setPaged({ key: listKey, page: n });
    document.querySelector(".app-body")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  // The category list is read the first time the picker opens; Back closes the picker, not the page.
  useEffect(() => {
    if (!picking) return;
    if (picking === "categories" && !categories) {
      adultCategories()
        .then(setCategories)
        .catch((e) => {
          console.warn("[adult]", e);
          setPicking(null);
          setNotice("Не удалось загрузить категории. Проверьте подключение и попробуйте ещё раз.");
        });
    }
    return onBack(() => {
      setPicking(null);
      return true;
    });
  }, [picking, categories]);

  useEffect(() => {
    if (!confirmed) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setVideos([]);
    adultList(search || undefined, category?.slug, performer?.path, page)
      .then(({ videos: got, totalPages }) => {
        if (cancelled) return;
        setVideos(got);
        setPageCount(totalPages);
        if (refocus.current) {
          refocus.current = false;
          window.setTimeout(() => void setFocus("adult:0"), 80);
        }
      })
      .catch((e) => {
        console.warn("[adult]", e);
        if (!cancelled) setFailed(true);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [confirmed, search, category, performer, page, tries]);

  // The actresses of the same words, beside the videos (a failure only means there is no row of them).
  useEffect(() => {
    if (!confirmed || !search) {
      setPerformers([]);
      return;
    }
    let cancelled = false;
    adultPerformers(search)
      .then((list) => !cancelled && setPerformers(list))
      .catch(() => !cancelled && setPerformers([]));
    return () => {
      cancelled = true;
    };
  }, [confirmed, search]);

  const pickPerformer = (p: AdultPerformer) => {
    setPerformer(p);
    setCategory(undefined);
    setQuery("");
    setSearch("");
    setPicking(null);
  };

  const play = (video: AdultVideo) => {
    if (opening) return;
    setOpening(true);
    adultStreams(video.key)
      .then(({ qualities, defaultIndex }) => {
        const chosen = qualities[defaultIndex];
        if (!chosen) return setNotice("У этого видео нет доступных потоков.");
        navigate({ name: "player", title: video.title, url: chosen.url, qualities, qualityIndex: defaultIndex });
      })
      .catch((e) => {
        console.warn("[adult]", e);
        setNotice(typeof e === "string" ? e : "Не удалось получить поток. Попробуйте ещё раз.");
      })
      .finally(() => setOpening(false));
  };

  return (
    <FocusGroup focusKey="adult" className="screen-pad home home--tv home--nohero">
      <HomeChrome id="adult" label="Для взрослых" hideSearch autoFocus={!confirmed} />
      {!confirmed && (
        <AgeGate
          onYes={() => {
            confirmAdult();
            setConfirmed(true);
          }}
          onNo={() => back()}
        />
      )}
      {confirmed && picking === "actors" && (
        <div className="home__rows">
          <AdultActors onPick={pickPerformer} toTop={toTop} />
        </div>
      )}
      {confirmed && picking === "categories" && (
        <div className="home__rows">
          <section className="cats__group">
            <h2 className="cats__title">Категории</h2>
            {!categories ? (
              <div style={{ display: "grid", placeItems: "center", height: 300 }}>
                <Spinner />
              </div>
            ) : (
              <div className="cats__tiles">
                {categories.map((c, i) => (
                  <Focusable
                    key={c.slug}
                    as="button"
                    className="cats__tile"
                    focusKey={`adult:cat:${i}`}
                    autoFocus={i === 0}
                    style={{ "--tile-hue": (i * 47) % 360 } as React.CSSProperties}
                    onPress={() => {
                      setCategory(c);
                      setPerformer(undefined);
                      setQuery("");
                      setSearch("");
                      setPicking(null);
                    }}
                  >
                    <div className="cats__tile-art">{c.image && <img src={img(c.image)} alt="" loading="lazy" decoding="async" />}</div>
                    <span className="cats__tile-name">{c.name}</span>
                  </Focusable>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      {confirmed && picking === null && (
        <div className="home__rows">
          {(category || performer) && (
            <div className="cats__chips">
              <Focusable
                as="button"
                className="cats__chip is-active"
                focusKey="adult:cats:clear"
                scroll={false}
                onFocus={toTop}
                onPress={() => {
                  setCategory(undefined);
                  setPerformer(undefined);
                }}
              >
                {performer?.name ?? category?.name} ×
              </Focusable>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "stretch", gap: "calc(14 * var(--u))", marginBottom: "calc(26 * var(--u))" }}>
            <div className="ctv__search" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
              <TextField focusKey="adult:search" scroll={false} onFocus={toTop} type="search" value={query} onChange={setQuery} placeholder="Поиск" icon={<SearchIcon />} className="field--grow" />
            </div>
            <Focusable as="button" className="cats__chip adult__cats" focusKey="adult:actors" scroll={false} onFocus={toTop} onPress={() => setPicking("actors")}>
              <ActorsIcon />
              Актёры
            </Focusable>
            <Focusable as="button" className="cats__chip adult__cats" focusKey="adult:cats" scroll={false} onFocus={toTop} onPress={() => setPicking("categories")}>
              <CategoriesIcon size={24} />
              Категории
            </Focusable>
          </div>
          {search && page === 1 && performers.length > 0 && (
            <section className="cats__group" style={{ marginBottom: "calc(30 * var(--u))" }}>
              <h2 className="cats__title">Актрисы</h2>
              <div className="cats__tiles">
                {performers.slice(0, 6).map((p, i) => (
                  <Focusable
                    key={p.path}
                    as="button"
                    className="cats__tile"
                    focusKey={`adult:performer:${i}`}
                    style={{ "--tile-hue": (i * 61 + 300) % 360 } as React.CSSProperties}
                    onPress={() => pickPerformer(p)}
                  >
                    <div className="cats__tile-art">{p.image && <img src={img(p.image)} alt="" loading="lazy" decoding="async" style={{ objectPosition: "center 20%", opacity: 1 }} />}</div>
                    <span className="cats__tile-name">
                      {p.name}
                      {p.videos && <small style={{ display: "block", fontSize: "0.6em", fontWeight: 600, opacity: 0.75 }}>{p.videos}</small>}
                    </span>
                  </Focusable>
                ))}
              </div>
            </section>
          )}
          {videos.length === 0 && loading && (
            <div style={{ display: "grid", placeItems: "center", height: 300 }}>
              <Spinner />
            </div>
          )}
          {videos.length === 0 && !loading && failed && (
            <>
              <EmptyState error icon={<OfflineIcon size={38} strokeWidth={1.6} />} title="Не удалось загрузить раздел" hint="Проверьте подключение (возможно, нужен VPN) и попробуйте ещё раз." />
              <div style={{ display: "flex", justifyContent: "center", padding: "calc(8 * var(--u))" }}>
                <Focusable as="button" className="cats__chip" focusKey="adult:retry" autoFocus onPress={() => setTries((n) => n + 1)}>
                  Повторить
                </Focusable>
              </div>
            </>
          )}
          {videos.length === 0 && !loading && !failed && <EmptyState icon={<SearchIcon size={38} strokeWidth={1.6} />} title="Ничего не найдено" />}
          {videos.length > 0 && (
            <div className="grid-cards grid-cards--wide">
              <FocusHighlight radius={26} />
              {videos.map((video, i) => (
                <VideoCard key={video.key} video={video} focusKey={`adult:${i}`} onPress={() => play(video)} />
              ))}
            </div>
          )}
          {videos.length > 0 && pageCount > 1 && (
            <nav className="adult__pager" aria-label="Страницы">
              {page > 1 && (
                <Focusable as="button" className="cats__chip adult__page" focusKey="adult:page:prev" aria-label="Назад" onPress={() => goTo(page - 1)}>
                  ‹
                </Focusable>
              )}
              {pageItems(page, pageCount).map((n, i) =>
                n === "gap" ? (
                  <span key={`gap${i}`} className="adult__gap">
                    …
                  </span>
                ) : (
                  <Focusable
                    key={n}
                    as="button"
                    className={`cats__chip adult__page ${n === page ? "is-active" : ""}`}
                    focusKey={`adult:page:${n}`}
                    onPress={() => n !== page && goTo(n)}
                  >
                    {n}
                  </Focusable>
                ),
              )}
              {page < pageCount && (
                <Focusable as="button" className="cats__chip adult__page" focusKey="adult:page:next" aria-label="Дальше" onPress={() => goTo(page + 1)}>
                  ›
                </Focusable>
              )}
            </nav>
          )}
        </div>
      )}
      {/* In <body>, like the windows: inside the page a fixed layer is only as big as the page's own box. No dimming, just the loader. */}
      {opening &&
        createPortal(
          <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", pointerEvents: "none" }}>
            <div style={{ display: "grid", placeItems: "center", width: 96, height: 96, borderRadius: 48, background: "rgba(46, 46, 50, 0.88)", backdropFilter: "blur(20px)" }}>
              <Spinner />
            </div>
          </div>,
          document.body,
        )}
      {notice && (
        <Modal focusKey="adult:notice" preferredChildFocusKey="adult:notice:close" className="links-tv" onClose={() => setNotice(null)}>
          <h3 className="links-tv__title">Не получилось</h3>
          <p className="links-tv__text">{notice}</p>
          <div className="links-tv__list">
            <Focusable as="button" back className="links-tv__row links-tv__row--primary" focusKey="adult:notice:close" autoFocus scroll={false} onPress={() => setNotice(null)}>
              <span className="links-tv__name">Понятно</span>
            </Focusable>
          </div>
        </Modal>
      )}
    </FocusGroup>
  );
}
