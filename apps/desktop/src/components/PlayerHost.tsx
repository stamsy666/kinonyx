import { useApp } from "../store/app";
import { PlayerScreen } from "../screens/PlayerScreen";
import { TvPlayerScreen } from "../screens/tv/TvPlayerScreen";

/**
 * Renders the active player. It lives here, outside the router, so a minimised player keeps
 * playing in the corner while the viewer browses; the router only decides whether it is full
 * screen (the current screen is a player route) or mini (any other screen).
 */
export function PlayerHost() {
  const route = useApp((s) => s.activePlayer);
  const mini = useApp((s) => s.screen.name !== "player" && s.screen.name !== "tv-player");
  if (!route) return null;

  if (route.name === "player") {
    return (
      <PlayerScreen
        key={route.url}
        mini={mini}
        title={route.title}
        url={route.url}
        qualities={route.qualities}
        qualityIndex={route.qualityIndex}
        hash={route.hash}
        filmId={route.filmId}
        poster={route.poster}
        film={route.film}
        episodes={route.episodes}
      />
    );
  }
  return (
    <TvPlayerScreen
      key={`${route.channelId}:${route.programme?.start ?? "live"}`}
      mini={mini}
      channelId={route.channelId}
      programme={route.programme}
    />
  );
}
