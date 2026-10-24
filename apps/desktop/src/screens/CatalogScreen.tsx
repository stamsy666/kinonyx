import { FocusGroup } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { kpCollection, kpFilmsFilter, type KpCollectionItem } from "../data/api";
import { catalogsFor, type CatalogKind, type CatalogShelf } from "../data/catalogs";
import { LazyShelf } from "../components/LazyShelf";
import { useHomeFeel } from "../components/useHomeFeel";
import { HomeChrome } from "../components/HomeChrome";

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
  // Shelves differ per metadata source (Kinopoisk vs TMDB genre ids and lists); wait for the
  // source to be known so the wrong set never loads first.
  const source = useApp((s) => s.metadataSource);
  const catalog = source ? catalogsFor(source)[kind] : null;
  const open = (film: KpCollectionItem) => navigate({ name: "movie", id: film.kinopoiskId, preview: film });

  useHomeFeel(catalog);

  return (
    <FocusGroup focusKey={`catalog:${kind}`} className="screen-pad home home--tv home--nohero">
      <HomeChrome id="catalog" label={catalogsFor(source ?? "kinopoisk")[kind].title} />

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
