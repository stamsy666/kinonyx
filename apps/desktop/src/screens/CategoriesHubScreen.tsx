import { Focusable, FocusGroup } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { CATALOGS, categoryListsFor, type CatalogKind } from "../data/catalogs";
import { useHomeFeel } from "../components/useHomeFeel";
import { HomeChrome } from "../components/HomeChrome";

const KINDS: CatalogKind[] = ["films", "series", "cartoons"];

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
            <div className="cats__chips">
              {categoryLists[kind].map((cat, i) => (
                <Focusable
                  key={cat.title}
                  as="button"
                  className="cats__chip"
                  focusKey={`cathub:${kind}:${i}`}
                  autoFocus={ki === 0 && i === 0}
                  onPress={() => navigate({ name: "genre", kind, title: cat.title, filter: cat.filter })}
                >
                  {cat.title}
                </Focusable>
              ))}
            </div>
          </section>
        ))}
      </div>
    </FocusGroup>
  );
}
