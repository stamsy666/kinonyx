import { FocusGroup } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { useFavorites } from "../store/favorites";
import { TvScreenHeader } from "../components/TvScreenHeader";
import { MovieCard } from "../components/MovieCard";
import { FocusHighlight } from "../components/FocusHighlight";

export function FavoritesScreen() {
  const navigate = useApp((s) => s.navigate);
  const back = useApp((s) => s.back);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const films = useFavorites((s) => s.items);

  const open = (film: (typeof films)[number]) => navigate({ name: "movie", id: film.kinopoiskId, preview: film });

  return (
    <FocusGroup focusKey="favorites" className="screen">
      <TvScreenHeader title="Избранное" onMenu={toggleSidebar} onBack={() => back()} onSettings={() => navigate({ name: "settings" })} />
      <div className="screen__body">
        {films.length === 0 ? (
          <p className="empty">Пока пусто — добавляйте фильмы сердечком на странице фильма.</p>
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
