import { useEffect, useMemo, useRef, useState } from "react";
import { Focusable, OfflineIcon, SearchIcon, Spinner } from "@kinonyx/ui";
import { EmptyState } from "./EmptyState";
import { TextField } from "./TextField";
import { adultModels, adultPerformers, type AdultPerformer } from "../data/api";
import { img } from "../data/images";

/** The pages of the site's list of models read for one search, at most: they are asked for one after another. */
const MAX_PAGES = 25;

/** The same person in the same words, whatever the letters: "Ёлка"/"елка", "Riley  Reid"/"riley reid". */
function loose(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

/** "Актёры": the site's models as tiles, the busiest first, read page after page as the viewer scrolls down. Typing a name
 *  narrows what is read so far — and, while nothing matches yet, reads further pages (one by one, not in a burst) — and also
 *  looks for the person whose page has that name's address. */
export function AdultActors({ onPick, toTop }: { onPick: (p: AdultPerformer) => void; toTop: () => void }) {
  const [models, setModels] = useState<AdultPerformer[]>([]);
  const [pages, setPages] = useState(0);
  const [hasNext, setHasNext] = useState(true);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  const [guess, setGuess] = useState<AdultPerformer[]>([]);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // The query that counts is the one the typing paused on.
  useEffect(() => {
    const t = window.setTimeout(() => setTyped(loose(query)), 350);
    return () => window.clearTimeout(t);
  }, [query]);

  const shown = useMemo(() => {
    const byPath = new Set<string>();
    const out: AdultPerformer[] = [];
    const matches = (m: AdultPerformer) => !typed || loose(m.name).includes(typed) || loose(m.altName).includes(typed);
    for (const m of [...guess, ...models]) {
      if (!byPath.has(m.path) && matches(m)) {
        byPath.add(m.path);
        out.push(m);
      }
    }
    return out;
  }, [models, guess, typed]);

  // The person whose page address is the typed name (the list has only so many pages; this reaches the rest).
  useEffect(() => {
    if (!typed) {
      setGuess([]);
      return;
    }
    let cancelled = false;
    adultPerformers(typed)
      .then((list) => !cancelled && setGuess(list))
      .catch(() => !cancelled && setGuess([]));
    return () => {
      cancelled = true;
    };
  }, [typed]);

  // One page at a time: a request goes out only when the last has come back.
  const next = pages + 1;
  const wanted = hasNext && !failed && pages < MAX_PAGES && !loading;
  const loadNext = () => {
    if (!wanted) return;
    setLoading(true);
    adultModels(next)
      .then(({ models: got, hasNext: more }) => {
        setModels((prev) => [...prev, ...got.filter((g) => !prev.some((p) => p.path === g.path))]);
        setPages(next);
        setHasNext(more && got.length > 0);
      })
      .catch((e) => {
        console.warn("[adult]", e);
        setFailed(true);
      })
      .finally(() => setLoading(false));
  };

  // The first page, and — while a search has no match in what is read — the next ones, a moment apart.
  useEffect(() => {
    if (!wanted) return;
    if (pages === 0) return loadNext();
    if (typed && shown.length === 0) {
      const t = window.setTimeout(loadNext, 600);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, pages, typed, shown.length]);

  // Scrolling down to the end of the tiles reads the next page.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadNext(), { rootMargin: "500px 0px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, next]);

  const searching = !!typed && shown.length === 0 && (loading || (hasNext && pages < MAX_PAGES && !failed));

  return (
    <section className="cats__group">
      <h2 className="cats__title">Актёры</h2>
      <div className="ctv__search">
        <TextField focusKey="actors:search" scroll={false} onFocus={toTop} autoFocus type="search" value={query} onChange={setQuery} placeholder="Имя актёра" icon={<SearchIcon />} className="field--grow" />
      </div>
      {shown.length > 0 && (
        <div className="cats__tiles">
          {shown.map((p, i) => (
            <Focusable
              key={p.path}
              as="button"
              className="cats__tile"
              focusKey={`actors:${i}`}
              style={{ "--tile-hue": (i * 53 + 300) % 360 } as React.CSSProperties}
              onPress={() => onPick(p)}
            >
              <div className="cats__tile-art">{p.image && <img src={img(p.image)} alt="" loading="lazy" decoding="async" style={{ objectPosition: "center 20%", opacity: 1 }} />}</div>
              <span className="cats__tile-name">
                {p.name}
                <small style={{ display: "block", fontSize: "0.6em", fontWeight: 600, opacity: 0.75 }}>
                  {[p.altName, p.videos && `${p.videos} видео`].filter(Boolean).join(" · ")}
                </small>
              </span>
            </Focusable>
          ))}
        </div>
      )}
      {shown.length === 0 && (loading || searching || pages === 0) && !failed && (
        <div style={{ display: "grid", placeItems: "center", height: 260 }}>
          <Spinner />
        </div>
      )}
      {shown.length === 0 && !searching && !loading && !failed && pages > 0 && <EmptyState icon={<SearchIcon size={38} strokeWidth={1.6} />} title="Никого не нашли" hint="Попробуйте другое написание имени." />}
      {failed && (
        <>
          <EmptyState error icon={<OfflineIcon size={38} strokeWidth={1.6} />} title="Не удалось загрузить актёров" hint="Проверьте подключение и попробуйте ещё раз." />
          <div style={{ display: "flex", justifyContent: "center", padding: "calc(8 * var(--u))" }}>
            <Focusable as="button" className="cats__chip" focusKey="actors:retry" onPress={() => setFailed(false)}>
              Повторить
            </Focusable>
          </div>
        </>
      )}
      <div ref={sentinelRef} style={{ height: 1 }} />
    </section>
  );
}
