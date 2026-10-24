import { FocusGroup } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { useFavorites } from "../store/favorites";
import { HomeChrome } from "../components/HomeChrome";
import { MovieCard } from "../components/MovieCard";
import { FocusHighlight } from "../components/FocusHighlight";
import { useHomeFeel } from "../components/useHomeFeel";

export function FavoritesScreen() {
  const navigate = useApp((s) => s.navigate);
  const films = useFavorites((s) => s.items);
  useHomeFeel(null);

  const open = (film: (typeof films)[number]) => navigate({ name: "movie", id: film.kinopoiskId, preview: film });

  return (
    <FocusGroup focusKey="favorites" className="screen-pad home home--tv home--nohero">
      <HomeChrome id="favorites" label="Избранное" />
      <div className="home__rows">
        {films.length === 0 ? (
          <p className="empty favorites__empty">Пока пусто — добавляйте фильмы сердечком на странице фильма.</p>
        ) : (
          <div className="grid-cards">
            <FocusHighlight />
            {films.map((film, i) => (
              <MovieCard key={film.kinopoiskId} film={film} focusKey={`favorites:${i}`} autoFocus={i === 0} onPress={() => open(film)} />
            ))}
          </div>
        )}
      </div>
    </FocusGroup>
  );
}
