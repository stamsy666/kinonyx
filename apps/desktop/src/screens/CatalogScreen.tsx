import { CategoriesIcon, Focusable, FocusGroup, } from "@kinonyx/ui";
import { SearchLensIcon } from "../components/AnimatedIcons";
import { useApp } from "../store/app";
import { kpCollection, kpFilmsFilter, type KpCollectionItem } from "../data/api";
import { catalogsFor, type CatalogKind, type CatalogShelf } from "../data/catalogs";
import { LazyShelf } from "../components/LazyShelf";
import { FullscreenButton } from "../components/FullscreenButton";

// Per the sketch: six posters across, the rest paged sideways.
const PER_VIEW = 6;

function loader(shelf: CatalogShelf): () => Promise<KpCollectionItem[]> {
  const s = shelf.source;
  return "collection" in s ? () => kpCollection(s.collection, 1).then((r) => r.items ?? []) : () => kpFilmsFilter(s.filter).then((r) => r.items ?? []);
}

/** Фильмы / Сериалы / Мультфильмы — same layout (user's sketch): centred title, search on
 *  the right, then themed shelves scrolling down. */
export function CatalogScreen({ kind }: { kind: CatalogKind }) {
  const navigate = useApp((s) => s.navigate);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  // Shelves differ per metadata source (Kinopoisk vs TMDB genre ids and lists); wait for the
  // source to be known so the wrong set never loads first.
  const source = useApp((s) => s.metadataSource);
  const catalog = source ? catalogsFor(source)[kind] : null;
  const open = (film: KpCollectionItem) => navigate({ name: "movie", id: film.kinopoiskId, preview: film });

  return (
    <FocusGroup focusKey={`catalog:${kind}`} className="catalog screen-pad">
      <header className="catalog__head">
        <Focusable as="button" className="icon-btn" focusKey="catalog:menu" onPress={toggleSidebar} scrollBlock="start">
          <span className="burger">
            <i />
            <i />
            <i />
          </span>
        </Focusable>
        <h1 className="catalog__title">{catalogsFor(source ?? "kinopoisk")[kind].title}</h1>
        <div className="row">
          <Focusable as="button" className="icon-btn" focusKey="catalog:categories" onPress={() => navigate({ name: "categories-hub" })} scrollBlock="start">
            <CategoriesIcon />
          </Focusable>
          <Focusable as="button" className="icon-btn" focusKey="catalog:search" onPress={() => navigate({ name: "search" })} scrollBlock="start">
            <SearchLensIcon />
          </Focusable>
          <FullscreenButton focusKey="catalog:fullscreen" />
        </div>
      </header>

      {catalog?.shelves.map((shelf, i) => (
        <LazyShelf
          key={`${source}:${kind}:${shelf.title}`}
          title={shelf.title}
          text={shelf.text}
          load={loader(shelf)}
          focusPrefix={`${kind}${i}`}
          perView={PER_VIEW}
          autoFocusFirst={i === 0}
          onOpen={open}
        />
      ))}
    </FocusGroup>
  );
}
