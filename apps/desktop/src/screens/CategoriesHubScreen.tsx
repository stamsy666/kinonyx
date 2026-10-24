import { Focusable, FocusGroup } from "@kinonyx/ui";
import { SearchLensIcon } from "../components/AnimatedIcons";
import { useApp } from "../store/app";
import { CATALOGS, categoryListsFor, type CatalogKind } from "../data/catalogs";
import { FullscreenButton } from "../components/FullscreenButton";
import { useHomeFeel } from "../components/useHomeFeel";
import logoMark from "../assets/logo-mark.png";

const KINDS: CatalogKind[] = ["films", "series", "cartoons"];

/** "Категории" — every genre for Фильмы/Сериалы/Мультфильмы on one page, grouped under a heading per
 *  kind, as glass pills in the home page's look. Picking one opens the full poster grid for that genre. */
export function CategoriesHubScreen() {
  const navigate = useApp((s) => s.navigate);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const source = useApp((s) => s.metadataSource) ?? "kinopoisk";
  const categoryLists = categoryListsFor(source);
  useHomeFeel(null);

  return (
    <FocusGroup focusKey="categories-hub" className="screen-pad home home--tv home--nohero">
      <div className="home__chrome">
        <div className="home__chrome-left">
          <Focusable
            as="button"
            className="home-round"
            focusKey="home:menu"
            scroll={false}
            onFocus={() => document.querySelector(".app-body")?.scrollTo({ top: 0, behavior: "smooth" })}
            onPress={toggleSidebar}
          >
            <svg className="menu-icon" width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
                <path d="M5 5h14" />
                <path d="M5 12h14" />
                <path d="M5 19h14" />
              </g>
            </svg>
          </Focusable>
          <span className="home__section">Категории</span>
        </div>
        <div className="topbar__logo home__brand" aria-hidden="true">
          <img className="topbar__logo-mark" src={logoMark} alt="" />
          <span>
            KINON<em>YX</em>
          </span>
        </div>
        <div className="home__chrome-right">
          <Focusable as="button" className="home-round" focusKey="cathub:search" scroll={false} onPress={() => navigate({ name: "search" })}>
            <SearchLensIcon />
          </Focusable>
          <FullscreenButton focusKey="cathub:fullscreen" className="home-round" />
        </div>
      </div>

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
