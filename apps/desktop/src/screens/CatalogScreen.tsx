import { Focusable, FocusGroup } from "@kinonyx/ui";
import { SearchLensIcon } from "../components/AnimatedIcons";
import { useApp } from "../store/app";
import { kpCollection, kpFilmsFilter, type KpCollectionItem } from "../data/api";
import { catalogsFor, type CatalogKind, type CatalogShelf } from "../data/catalogs";
import { LazyShelf } from "../components/LazyShelf";
import { FullscreenButton } from "../components/FullscreenButton";
import { useHomeFeel } from "../components/useHomeFeel";
import logoMark from "../assets/logo-mark.png";

function loader(shelf: CatalogShelf): () => Promise<KpCollectionItem[]> {
  const s = shelf.source;
  return "collection" in s ? () => kpCollection(s.collection, 1).then((r) => r.items ?? []) : () => kpFilmsFilter(s.filter).then((r) => r.items ?? []);
}

/** How the shelves alternate down the page, as on the home page: numbered posters, big cards, a wide
 *  collection banner over a row of posters, plain posters. */
const LOOKS = ["posters", "feature", "banner", "posters"] as const;

/**
 * Фильмы / Сериалы / Мультфильмы — the home page's look, without the banner: themed shelves that alternate between posters, big cards and collection banners.
 */
export function CatalogScreen({ kind }: { kind: CatalogKind }) {
  const navigate = useApp((s) => s.navigate);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  // Shelves differ per metadata source (Kinopoisk vs TMDB genre ids and lists); wait for the
  // source to be known so the wrong set never loads first.
  const source = useApp((s) => s.metadataSource);
  const catalog = source ? catalogsFor(source)[kind] : null;
  const open = (film: KpCollectionItem) => navigate({ name: "movie", id: film.kinopoiskId, preview: film });

  useHomeFeel(catalog);

  return (
    <FocusGroup focusKey={`catalog:${kind}`} className="screen-pad home home--tv home--nohero">
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
          <span className="home__section">{catalogsFor(source ?? "kinopoisk")[kind].title}</span>
        </div>
        <div className="topbar__logo home__brand" aria-hidden="true">
          <img className="topbar__logo-mark" src={logoMark} alt="" />
          <span>
            KINON<em>YX</em>
          </span>
        </div>
        <div className="home__chrome-right">
          <Focusable as="button" className="home-round" focusKey="catalog:search" scroll={false} onPress={() => navigate({ name: "search" })}>
            <SearchLensIcon />
          </Focusable>
          <FullscreenButton focusKey="catalog:fullscreen" className="home-round" />
        </div>
      </div>

      {catalog && (
        <div className="home__rows">
          {catalog.shelves.map((shelf, i) => (
            <LazyShelf
              key={`${source}:${kind}:${shelf.title}`}
              title={shelf.title}
              text={shelf.text}
              load={loader(shelf)}
              focusPrefix={`${kind}${i}`}
              autoFocusFirst={i === 0}
              ranked={i === 0}
              limit={i === 0 ? 10 : undefined}
              variant={i === 0 ? "posters" : LOOKS[i % LOOKS.length]}
              onOpen={open}
            />
          ))}
        </div>
      )}
    </FocusGroup>
  );
}
