import { useEffect, type ReactNode } from "react";
import { useApp } from "./store/app";
import { onBack } from "@kinonyx/ui";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { AppBackground } from "./components/backgrounds/AppBackground";
import { ClickSpark } from "./components/ClickSpark";
import { configStatus } from "./data/api";
import { isTauri } from "./data/io";
import { rematchAll } from "./data/rematch";
import { useUpdater } from "./store/updater";
import { clearPresence, setPresence } from "./data/discord";
import { UpdateModal } from "./components/UpdateModal";
import { installSoundEngine } from "./data/sounds";
import { installMusicEngine } from "./data/music";
import { applyUiZoom } from "./data/uiZoom";
import { installInputModeTracker } from "./data/inputMode";
import { HomeScreen } from "./screens/HomeScreen";
import { MovieScreen } from "./screens/MovieScreen";
import { PersonScreen } from "./screens/PersonScreen";
import { GalleryScreen } from "./screens/GalleryScreen";
import { WebTrailerScreen } from "./screens/WebTrailerScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { DiagnosticsScreen } from "./screens/DiagnosticsScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { FavoritesScreen } from "./screens/FavoritesScreen";
import { CatalogScreen } from "./screens/CatalogScreen";
import { CategoriesHubScreen } from "./screens/CategoriesHubScreen";
import { GenreScreen } from "./screens/GenreScreen";
import { TvPlaylistsScreen } from "./screens/tv/TvPlaylistsScreen";
import { TvCategoriesScreen } from "./screens/tv/TvCategoriesScreen";
import { TvChannelsScreen } from "./screens/tv/TvChannelsScreen";
import { PlayerHost } from "./components/PlayerHost";

function CurrentScreen() {
  const screen = useApp((s) => s.screen);
  switch (screen.name) {
    case "home":
      return <HomeScreen />;
    case "catalog":
      return <CatalogScreen key={screen.kind} kind={screen.kind} />;
    case "categories-hub":
      return <CategoriesHubScreen />;
    case "genre":
      return (
        <GenreScreen
          key={`${screen.kind}:${screen.title}`}
          title={screen.title}
          filter={screen.filter}
        />
      );
    case "movie":
      return (
        <MovieScreen key={screen.id} id={screen.id} preview={screen.preview} />
      );
    case "person":
      return (
        <PersonScreen key={screen.id} id={screen.id} preview={screen.preview} />
      );
    case "gallery":
      return (
        <GalleryScreen
          key={screen.filmId}
          filmId={screen.filmId}
          startIndex={screen.startIndex}
        />
      );
    case "player":
    case "tv-player":
      return null; // drawn by PlayerHost, so it can outlive the screen (minimised player)
    case "web-trailer":
      return (
        <WebTrailerScreen
          key={screen.url}
          title={screen.title}
          url={screen.url}
        />
      );
    case "search":
      return <SearchScreen />;
    case "favorites":
      return <FavoritesScreen />;
    case "tv":
      return <TvPlaylistsScreen />;
    case "tv-categories":
      return <TvCategoriesScreen />;
    case "tv-channels":
      return (
        <TvChannelsScreen key={screen.group ?? "*"} group={screen.group} />
      );
    case "settings":
      return <SettingsScreen />;
    case "setup":
      return <SetupScreen />;
    case "diagnostics":
      return <DiagnosticsScreen />;
  }
}

export function App() {
  const back = useApp((s) => s.back);
  const backgroundKind = useApp((s) => s.backgroundKind);
  const clickSparkEnabled = useApp((s) => s.clickSparkEnabled);
  const isPlayer = useApp(
    (s) =>
      s.screen.name === "player" ||
      s.screen.name === "tv-player" ||
      s.screen.name === "web-trailer",
  );
  // PortoTV's screens (and, styled the same way, the genre category screens) are
  // full-window with their own header and scrolling — no app-shell top bar.
  const isFullScreen = useApp((s) =>
    ["tv", "tv-categories", "tv-channels", "genre", "favorites"].includes(
      s.screen.name,
    ),
  );
  // Per the sketches, these pages carry their own header instead of the app top bar.
  const ownHeader = useApp(
    (s) =>
      s.screen.name === "settings" ||
      s.screen.name === "setup" ||
      s.screen.name === "diagnostics" ||
      s.screen.name === "catalog" ||
      s.screen.name === "categories-hub",
  );

  useEffect(() => onBack(() => back()), [back]);

  useEffect(() => {
    void configStatus()
      .then((s) => {
        useApp.getState().setMetadataSourceState(s.metadata_source);
        // Finishes a re-match a previous run didn't (e.g. TMDB was unreachable without VPN).
        void rematchAll(s.metadata_source);
        // Wizard only for a genuinely fresh install: existing users already have a key.
        const hasKey = s.metadata_source === "tmdb" ? s.tmdb_key_masked : s.kinopoisk_key_masked;
        if (!s.setup_done && !hasKey) useApp.getState().navigate({ name: "setup" });
      })
      .catch(() => useApp.getState().setMetadataSourceState("kinopoisk"));
  }, []);

  // Discord status while browsing (players set their own while they are open).
  const discordEnabled = useApp((s) => s.discordEnabled);
  const hasPlayer = useApp((s) => s.activePlayer !== null);
  useEffect(() => {
    if (isPlayer || hasPlayer) return;
    if (discordEnabled) setPresence({ details: "Выбирает, что посмотреть", state: "в KINONYX" });
    else clearPresence();
  }, [isPlayer, hasPlayer, discordEnabled]);

  // A few seconds after launch, so the check never competes with the first screen's requests.
  useEffect(() => {
    const t = window.setTimeout(() => useUpdater.getState().maybeAutoCheck(), 6000);
    return () => window.clearTimeout(t);
  }, []);

  // Browser preview only: `?update` shows the "update available" window with sample data, so
  // its look can be reviewed without publishing a release.
  useEffect(() => {
    if (isTauri || !location.search.includes("update")) return;
    // `?update=downloading` / `installing` / `error` show the other states.
    const param = new URLSearchParams(location.search).get("update");
    const status = param === "downloading" || param === "installing" || param === "error" ? param : "available";
    useUpdater.setState({
      status,
      progress: status === "downloading" ? 0.45 : status === "installing" ? 1 : 0,
      error: status === "error" ? "Не удалось установить обновление: нет соединения с сервером." : null,
      dismissed: false,
      update: {
        version: "1.0.8",
        body: "Новые разделы в настройках, исправлена полоса перемотки в плеере, кнопки «Получить ключ на сайте».",
      } as never,
    });
  }, []);

  useEffect(() => installSoundEngine(), []);
  useEffect(() => installMusicEngine(), []);
  const uiZoom = useApp((s) => s.uiZoom);
  useEffect(() => {
    void applyUiZoom(uiZoom);
  }, [uiZoom]);
  useEffect(() => installInputModeTracker(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        void useApp.getState().toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const updateOffered = useUpdater((s) => (s.status === "available" || s.status === "downloading" || s.status === "installing" || (s.status === "error" && s.update !== null)) && !s.dismissed);
  const updateModal = updateOffered && !isPlayer ? <UpdateModal /> : null;

  let shell: ReactNode;
  if (isPlayer) {
    shell = <CurrentScreen />;
  } else if (isFullScreen) {
    shell = (
      <>
        <AppBackground key={backgroundKind} kind={backgroundKind} />
        <CurrentScreen />
        <Sidebar />
        <ClickSpark enabled={clickSparkEnabled} />
        {updateModal}
      </>
    );
  } else {
    shell = (
      <>
        <AppBackground key={backgroundKind} kind={backgroundKind} />
        <div className="app-shell">
          {!ownHeader && <TopBar />}
          <div
            className="app-body"
            style={ownHeader ? { paddingTop: 30 } : undefined}
          >
            <CurrentScreen />
          </div>
          <Sidebar />
        </div>
        <ClickSpark enabled={clickSparkEnabled} />
        {updateModal}
      </>
    );
  }

  // PlayerHost is always the second child, so the player keeps its state (and keeps playing)
  // when the screen around it changes — full screen, minimised, or while browsing.
  return (
    <>
      {shell}
      <PlayerHost />
    </>
  );
}
