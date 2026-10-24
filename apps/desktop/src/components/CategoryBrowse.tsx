import { useEffect, useRef, useState } from "react";
import { Focusable } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { CATALOGS, categoryListsFor, type CatalogKind, type CategoryDef } from "../data/catalogs";
import { kpFilmsFilter, kpImages } from "../data/api";
import { img, stillLarge } from "../data/images";

const KINDS: CatalogKind[] = ["films", "series", "cartoons"];

/** Films already shown on a tile of this page: no picture is used twice. */
const usedFilms = new Set<number>();

/** A tile of a genre: a colour of its own at once, and the poster of a popular title of that genre
 *  fades in once the tile gets near the screen (one cached request per genre, only for tiles in view). */
function CategoryTile({
  cat,
  hue,
  focusKey,
  autoFocus,
  onPress,
}: {
  cat: CategoryDef;
  hue: number;
  focusKey: string;
  autoFocus?: boolean;
  onPress: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [art, setArt] = useState<string | undefined>();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        kpFilmsFilter(cat.filter)
          .then(async (r) => {
            const film = (r.items ?? []).find((f) => f.posterUrlPreview && !usedFilms.has(f.kinopoiskId));
            if (!film) return;
            usedFilms.add(film.kinopoiskId);
            // A frame of the film fits a wide tile far better than the portrait poster; the poster is the fallback.
            const still = await kpImages(film.kinopoiskId, "STILL", 1).then((x) => x.items?.[0]?.imageUrl).catch(() => undefined);
            if (!cancelled) setArt(img(still ? stillLarge(still) : film.posterUrl || film.posterUrlPreview));
          })
          .catch(() => undefined);
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Focusable
      as="button"
      className="cats__tile"
      focusKey={focusKey}
      autoFocus={autoFocus}
      onPress={onPress}
      style={{ "--tile-hue": hue } as React.CSSProperties}
    >
      <div ref={ref} className="cats__tile-art">
        {art && <img src={art} alt="" decoding="async" />}
      </div>
      <span className="cats__tile-name">{cat.title}</span>
    </Focusable>
  );
}

/** Every genre of Фильмы / Сериалы / Мультфильмы under a heading per kind, as tiles. Picking one opens the
 *  genre page. Used by the "Категории" page and by the search page's "browse" panel. */
export function CategoryGroups({ prefix, autoFocusFirst }: { prefix: string; autoFocusFirst?: boolean }) {
  const navigate = useApp((s) => s.navigate);
  const source = useApp((s) => s.metadataSource) ?? "kinopoisk";
  const categoryLists = categoryListsFor(source);
  // A fresh page starts with no picture taken (tiles pick theirs as they come into view).
  useState(() => usedFilms.clear());
  return (
    <>
      {KINDS.map((kind, ki) => (
        <section key={kind} className="cats__group">
          <h2 className="cats__title">{CATALOGS[kind].title}</h2>
          <div className="cats__tiles">
            {categoryLists[kind].map((cat, i) => (
              <CategoryTile
                key={cat.title}
                cat={cat}
                hue={(ki * 70 + i * 47) % 360}
                focusKey={`${prefix}:${kind}:${i}`}
                autoFocus={autoFocusFirst && ki === 0 && i === 0}
                onPress={() => navigate({ name: "genre", kind, title: cat.title, filter: cat.filter })}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
