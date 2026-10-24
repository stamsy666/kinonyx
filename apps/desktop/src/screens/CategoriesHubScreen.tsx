import { useEffect, useRef, useState } from "react";
import { Focusable, FocusGroup } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { CATALOGS, categoryListsFor, type CatalogKind, type CategoryDef } from "../data/catalogs";
import { kpFilmsFilter } from "../data/api";
import { img } from "../data/images";
import { useHomeFeel } from "../components/useHomeFeel";
import { HomeChrome } from "../components/HomeChrome";

const KINDS: CatalogKind[] = ["films", "series", "cartoons"];

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
          .then((r) => {
            const film = (r.items ?? []).find((f) => f.posterUrlPreview);
            if (!cancelled && film) setArt(img(film.posterUrl || film.posterUrlPreview));
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

/** "Категории" — every genre for Фильмы/Сериалы/Мультфильмы on one page, grouped under a heading per
 *  kind, as glass pills in the home page's look. Picking one opens the full poster grid for that genre. */
export function CategoriesHubScreen() {
  const navigate = useApp((s) => s.navigate);
  const source = useApp((s) => s.metadataSource) ?? "kinopoisk";
  const categoryLists = categoryListsFor(source);
  useHomeFeel(null);

  return (
    <FocusGroup focusKey="categories-hub" className="screen-pad home home--tv home--nohero">
      <HomeChrome id="cathub" label="Категории" />

      <div className="home__rows cats">
        {KINDS.map((kind, ki) => (
          <section key={kind} className="cats__group">
            <h2 className="cats__title">{CATALOGS[kind].title}</h2>
            <div className="cats__tiles">
              {categoryLists[kind].map((cat, i) => (
                <CategoryTile
                  key={cat.title}
                  cat={cat}
                  hue={(ki * 70 + i * 47) % 360}
                  focusKey={`cathub:${kind}:${i}`}
                  autoFocus={ki === 0 && i === 0}
                  onPress={() => navigate({ name: "genre", kind, title: cat.title, filter: cat.filter })}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </FocusGroup>
  );
}
