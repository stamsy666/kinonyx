import { BackIcon, Focusable, FocusGroup, } from "@kinonyx/ui";
import { SearchLensIcon } from "../components/AnimatedIcons";
import { useApp } from "../store/app";
import { CATALOGS, categoryListsFor, type CatalogKind } from "../data/catalogs";
import { FullscreenButton } from "../components/FullscreenButton";
import { FocusHighlight } from "../components/FocusHighlight";

const KINDS: CatalogKind[] = ["films", "series", "cartoons"];

/** "Категории" — reached from the sidebar (and from each catalog page's own icon): every
 *  genre for Фильмы/Сериалы/Мультфильмы on one page, grouped under a heading per kind,
 *  as small tag buttons — matches the user's sketch exactly. Picking one opens the full
 *  poster grid for that genre (GenreScreen). */
export function CategoriesHubScreen() {
  const navigate = useApp((s) => s.navigate);
  const back = useApp((s) => s.back);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const source = useApp((s) => s.metadataSource) ?? "kinopoisk";
  const categoryLists = categoryListsFor(source);

  return (
    <FocusGroup focusKey="categories-hub" className="catalog screen-pad">
      <header className="catalog__head">
        <div className="row">
          <Focusable as="button" className="icon-btn" focusKey="cathub:menu" onPress={toggleSidebar} scrollBlock="start">
            <span className="burger">
              <i />
              <i />
              <i />
            </span>
          </Focusable>
          <Focusable back as="button" className="icon-btn" focusKey="cathub:back" onPress={() => back()} scrollBlock="start">
            <BackIcon />
          </Focusable>
        </div>
        <h1 className="catalog__title">Категории</h1>
        <div className="row">
          <Focusable as="button" className="icon-btn" focusKey="cathub:search" onPress={() => navigate({ name: "search" })} scrollBlock="start">
            <SearchLensIcon />
          </Focusable>
          <FullscreenButton focusKey="cathub:fullscreen" />
        </div>
      </header>

      {KINDS.map((kind, ki) => (
        <section key={kind} className="category-section">
          <h2 className="category-section__title">{CATALOGS[kind].title}</h2>
          <div className="category-chips">
            <FocusHighlight pad={8} radius={20} />
            {categoryLists[kind].map((cat, i) => (
              <Focusable
                key={cat.title}
                as="button"
                className="category-chip"
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
    </FocusGroup>
  );
}
