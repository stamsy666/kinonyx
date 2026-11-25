import { invoke } from "@tauri-apps/api/core";
import { FocusContext, getCurrentFocusKey, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { History, RotateCw } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { prepareMpv } from "@kinonyx/player-core";
import { BackIcon, cancelGlides, Focusable, FocusGroup, SearchIcon, Spinner, onBack } from "@kinonyx/ui";
import { FocusHighlight } from "../components/FocusHighlight";
import { HomeChrome } from "../components/HomeChrome";
import { Modal } from "../components/Modal";
import { SearchKeys, type SearchKeyMode } from "../components/SearchKeys";
import { TextField } from "../components/TextField";
import { resetScroll, returnedToSavedFocus } from "../data/focusRestore";
import {
  getImportedYoutubeSession,
  subscribeYoutubeSession,
  type ImportedYoutubeSession,
  type YoutubeChannel,
  type YoutubeCursor as Cursor,
  type YoutubeFeed as Feed,
  type YoutubeStream,
  type YoutubeVideo as Video,
  type YoutubeVideoPage as VideoPage,
} from "../data/youtube";
import { KxChannelLogo } from "../components/player/PlayerChrome";
import { isTauri, openExternal } from "../data/io";
import { playCategorySound } from "../data/sounds";
import { useApp } from "../store/app";
import "../styles/youtube.css";

interface Results {
  query: string;
  videos: Video[] | null;
  next?: Cursor | null;
  error?: string;
}

type Playback = { video: Video; error?: string };
const SEARCH_DELAY_MS = 450;
const VIDEO_URL = "https://www.youtube.com/watch?v=";

function YoutubePlaybackLoading() {
  const { ref, focusSelf } = useFocusable<HTMLDivElement>({
    focusKey: "youtube:play-loading",
    onArrowPress: () => false,
  });
  useEffect(() => { focusSelf(); }, [focusSelf]);

  return (
    <div ref={ref} className="yt-play-loading__status" role="status">
      <Spinner />
      <p>Загрузка</p>
    </div>
  );
}

interface SavedView {
  feed: Feed | null;
  results: Results | null;
  searchOpen: boolean;
  mode: SearchKeyMode;
}
const homeView: SavedView = { feed: null, results: null, searchOpen: false, mode: "ru" };
let homeSessionRevision = 0;
let historyView: SavedView | undefined;
let historySessionRevision: number | undefined;
const channelViews = new Map<string, SavedView>();

function viewFor(session: ImportedYoutubeSession, channel?: YoutubeChannel, watchHistory = false): SavedView {
  if (watchHistory) {
    if (!historyView || historySessionRevision !== session.revision) {
      historyView = { feed: null, results: null, searchOpen: false, mode: "ru" };
      historySessionRevision = session.revision;
    }
    return historyView;
  }
  if (!channel) {
    if (session.revision !== homeSessionRevision) {
      homeSessionRevision = session.revision;
      homeView.feed = session.feed && { ...session.feed, videos: shuffleFeed(session.feed.videos) };
      homeView.results = null;
      homeView.searchOpen = false;
    }
    return homeView;
  }
  const known = channelViews.get(channel.id);
  if (known) return known;
  const view: SavedView = { feed: null, results: null, searchOpen: false, mode: "ru" };
  if (channelViews.size >= 16) {
    const oldest = channelViews.keys().next().value;
    if (oldest) channelViews.delete(oldest);
  }
  channelViews.set(channel.id, view);
  return view;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function mergeVideos(current: Video[], incoming: Video[]): Video[] {
  const byId = new Map(current.map((video) => [video.id, video]));
  for (const video of incoming) {
    if (!byId.has(video.id)) byId.set(video.id, video);
  }
  return Array.from(byId.values());
}

function shuffleFeed(videos: Video[], previousFirst?: string): Video[] {
  const shuffled = [...videos];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  if (shuffled.length > 1 && shuffled[0].id === previousFirst) {
    shuffled.push(shuffled.shift()!);
  }
  return shuffled;
}

export function YoutubeScreen({ channel, watchHistory = false }: { channel?: YoutubeChannel; watchHistory?: boolean }) {
  const session = useSyncExternalStore(subscribeYoutubeSession, getImportedYoutubeSession);
  const refreshKey = watchHistory ? "youtube:history-refresh" : channel ? "youtube:channel-refresh" : "youtube:refresh";
  return (
    <FocusGroup focusKey="youtube" className="screen-pad home home--tv home--nohero yt-page"
      preferredChildFocusKey={channel || watchHistory ? refreshKey : "youtube:search-open"}>
      <YoutubeContent key={channel?.id ?? session.revision} channel={channel} watchHistory={watchHistory}
        refreshKey={refreshKey} session={session} />
    </FocusGroup>
  );
}

function YoutubeContent({ channel, watchHistory, refreshKey, session }: {
  channel?: YoutubeChannel;
  watchHistory: boolean;
  refreshKey: string;
  session: ImportedYoutubeSession;
}) {
  const [autofocus] = useState(() => !returnedToSavedFocus() || (!channel && !watchHistory && session.revision !== homeSessionRevision));
  const [saved] = useState(() => viewFor(session, channel, watchHistory));
  const navigate = useApp((s) => s.navigate);
  const [feed, setFeed] = useState(saved.feed);
  const [results, setResults] = useState(saved.results);
  const [feedBusy, setFeedBusy] = useState(!saved.feed);
  const [keyboard, setKeyboard] = useState(saved.searchOpen);
  const [draft, setDraft] = useState(saved.results?.query ?? "");
  const [mode, setMode] = useState<SearchKeyMode>(saved.mode);
  const [error, setError] = useState("");
  const [playback, setPlayback] = useState<Playback | null>(null);
  const feedRun = useRef(0);
  const searchRun = useRef(0);
  const playRun = useRef(0);
  const focusResults = useRef(false);
  const focusFeedVideos = useRef((!!channel || watchHistory) && !returnedToSavedFocus());
  const prefetchTimer = useRef(0);
  const side = useFocusable<HTMLElement>({ focusKey: "youtube:side", trackChildren: true, saveLastFocusedChild: true });
  const wide = keyboard && side.hasFocusedChild;
  const moreRef = useRef<HTMLDivElement>(null);
  const requestedMore = useRef<Cursor | null>(null);
  const [loadingMore, setLoadingMore] = useState<Cursor | null>(null);
  const [moreError, setMoreError] = useState<{ cursor: Cursor; message: string } | null>(null);

  const updateFeed = (value: Feed | null) => {
    saved.feed = value;
    setFeed(value);
  };
  const updateResults = (value: Results | null) => {
    saved.results = value;
    setResults(value);
  };

  const refresh = async (mixMore = false) => {
    const run = ++feedRun.current;
    setFeedBusy(true);
    setError("");
    try {
      let value = channel ? await invoke<Feed>("youtube_channel", { id: channel.id })
        : await invoke<Feed>(watchHistory ? "youtube_history" : "youtube_feed");
      if (run !== feedRun.current) return;
      if (channel) {
        const knownAvatar = saved.feed?.author?.avatar;
        if (knownAvatar && !value.author?.avatar) {
          value = { ...value, author: { name: value.author?.name || channel.name, avatar: knownAvatar } };
        }
      } else if (!watchHistory) {
        const cursor = value.next;
        if (mixMore && value.connected && cursor) {
          const more = await invoke<VideoPage>("youtube_more", { cursor }).catch(() => null);
          if (run !== feedRun.current) return;
          if (more) {
            value = { ...value, videos: mergeVideos(value.videos, more.videos), next: more.next?.token === cursor.token ? null : more.next };
          }
        }
        value = { ...value, videos: shuffleFeed(value.videos, saved.feed?.videos[0]?.id) };
      }
      updateFeed(value);
    } catch (reason) {
      if (run === feedRun.current) {
        setError(errorText(reason));
      }
    } finally {
      if (run === feedRun.current) setFeedBusy(false);
    }
  };

  useEffect(() => {
    if (isTauri) {
      void prepareMpv().catch(() => {});
      if (!saved.feed) void refresh();
      if (saved.results && !saved.results.videos) updateResults(null);
    }
    return () => {
      feedRun.current++;
      playRun.current++;
      searchRun.current++;
      requestedMore.current = null;
      window.clearTimeout(prefetchTimer.current);
    };
  }, []);

  useEffect(() => {
    const first = feed?.videos[0];
    if (!focusFeedVideos.current || !first) return;
    const frame = requestAnimationFrame(() => {
      focusFeedVideos.current = false;
      if (getCurrentFocusKey() === refreshKey) {
        void setFocus("youtube:video:" + first.id, { restore: true, skipScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [feed, refreshKey]);

  const search = async (query: string) => {
    const run = ++searchRun.current;
    updateResults({ query, videos: null });
    try {
      const page = await invoke<VideoPage>("youtube_search", { query });
      if (run !== searchRun.current) return;
      updateResults({ query, ...page });
    } catch (reason) {
      if (run !== searchRun.current) return;
      updateResults({ query, videos: [], error: errorText(reason) });
    }
  };

  const query = draft.trim();
  useEffect(() => {
    if (!keyboard || !query || query === results?.query) return;
    const timer = window.setTimeout(() => void search(query), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [keyboard, query, results?.query]);

  useEffect(() => {
    if (!focusResults.current || !results?.videos) return;
    focusResults.current = false;
    const first = results.videos[0];
    if (first && getCurrentFocusKey() === "youtube:query") void setFocus("youtube:video:" + first.id);
  }, [results]);

  const changeQuery = (value: string) => {
    const next = Array.from(value).slice(0, 160).join("");
    if (next.trim() !== query) {
      searchRun.current++;
      focusResults.current = false;
      updateResults(null);
    }
    setDraft(next);
  };

  const submitSearch = (value: string) => {
    const entered = value.trim();
    if (!entered) return;
    if (results?.query === entered && results.videos?.length) {
      void setFocus("youtube:video:" + results.videos[0].id);
      return;
    }
    focusResults.current = true;
    if (results?.query !== entered || results.error) void search(entered);
  };

  const openSearch = () => {
    if (!isTauri) {
      void openExternal("https://www.youtube.com");
      return;
    }
    saved.searchOpen = true;
    setKeyboard(true);
    resetScroll();
    requestAnimationFrame(() => void setFocus("youtube:lang"));
  };

  const prefetch = (video: Video) => {
    window.clearTimeout(prefetchTimer.current);
    prefetchTimer.current = window.setTimeout(() => {
      if (getCurrentFocusKey() === "youtube:video:" + video.id) void invoke<YoutubeStream>("youtube_play", { id: video.id, prefetch: true }).catch(() => {});
    }, 400);
  };

  const openVideo = async (video: Video) => {
    window.clearTimeout(prefetchTimer.current);
    const run = ++playRun.current;
    setPlayback({ video });
    try {
      const stream = await invoke<YoutubeStream>("youtube_play", { id: video.id });
      const { qualities, defaultIndex } = stream;
      if (run !== playRun.current) return;
      const selected = qualities[defaultIndex];
      if (!selected) throw new Error("YouTube не вернул видеопоток.");
      setPlayback(null);
      const author = {
        id: stream.channelId ?? video.channelId ?? channel?.id,
        name: stream.channel || video.channel || channel?.name || "",
        avatar: channel ? feed?.author?.avatar || channel.avatar || video.avatar : video.avatar,
      };
      navigate({
        name: "player", provider: "youtube", title: stream.title || video.title, url: selected.url, qualities, qualityIndex: defaultIndex,
        youtube: { videoId: video.id, author, live: stream.isLive ?? !!video.isLive },
      }, "youtube:video:" + video.id);
    } catch (reason) {
      if (run === playRun.current) setPlayback({ video, error: errorText(reason) });
    }
  };

  const closePlayback = () => {
    playRun.current++;
    setPlayback(null);
  };

  const showHome = () => {
    searchRun.current++;
    focusResults.current = false;
    saved.searchOpen = false;
    setKeyboard(false);
    setDraft("");
    updateResults(null);
    setError("");
    resetScroll();
    if (!feed && !feedBusy) void refresh();
    requestAnimationFrame(() => {
      void setFocus("youtube:search-open");
    });
  };

  const backToYoutube = () => {
    const { back, history, replace } = useApp.getState();
    const distance = [...history].reverse().findIndex((screen) => screen.name === "youtube" && !screen.channel && !screen.watchHistory);
    if (distance >= 0) {
      back(distance + 1);
    } else {
      resetScroll();
      replace({ name: "youtube" });
    }
  };

  useEffect(() => {
    if (playback || (!keyboard && !channel && !watchHistory)) return;
    return onBack(() => {
      if (useApp.getState().sidebarOpen) return false;
      if (keyboard) showHome();
      else backToYoutube();
      return true;
    });
  }, [channel, watchHistory, keyboard, playback, feed, feedBusy]);

  const searching = keyboard && !!query;
  const hasVideoFeed = !!channel || !!feed?.connected;
  const list = searching ? results?.videos : hasVideoFeed ? feed?.videos : undefined;
  const busy = searching ? !results?.videos : feedBusy;
  const contentError = searching ? results?.error : error || (feed?.expired ? undefined : feed?.error);
  const needsAccount = !searching && !hasVideoFeed && !busy && !contentError;
  const title = searching ? "Результаты" : watchHistory ? "История просмотров" : channel ? "Видео" : "Рекомендации";

  const cursor = searching ? results?.next : hasVideoFeed ? feed?.next : undefined;
  const appendPage = async () => {
    if (!cursor || requestedMore.current === cursor) return;
    requestedMore.current = cursor;
    setMoreError(null);
    setLoadingMore(cursor);
    try {
      const page = await invoke<VideoPage>("youtube_more", { cursor });
      const current = searching ? saved.results : saved.feed;
      if (!current || current.next !== cursor || requestedMore.current !== cursor) return;
      const videos = mergeVideos(current.videos ?? [], page.videos);
      const next = page.next?.token === cursor.token ? null : page.next;
      if (searching && saved.results) updateResults({ ...saved.results, videos, next });
      if (!searching && saved.feed) updateFeed({ ...saved.feed, videos, next });
    } catch (reason) {
      if (requestedMore.current === cursor) setMoreError({ cursor, message: errorText(reason) });
    } finally {
      if (requestedMore.current === cursor) requestedMore.current = null;
      setLoadingMore((current) => current === cursor ? null : current);
    }
  };

  useEffect(() => {
    const end = moreRef.current;
    if (!cursor || !end || moreError?.cursor === cursor || busy) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void appendPage();
    }, { root: end.closest(".app-body"), rootMargin: "0px 0px 420px" });
    observer.observe(end);
    return () => observer.disconnect();
  }, [cursor, busy, moreError, searching]);

  const moveFromResults = (direction: string) => {
    if (direction !== "up" && direction !== "down" && (!keyboard || direction !== "left")) return true;
    const panel: HTMLElement | null = side.ref.current;
    const grid = panel?.querySelector(".yt-grid");
    const focused = grid?.querySelector<HTMLElement>(".is-focused");
    if (!grid || !focused) return true;
    if (direction === "up") {
      const first = grid.querySelector<HTMLElement>(".yt-video");
      if (!first || focused.offsetTop !== first.offsetTop) return true;
      cancelGlides();
      document.querySelector(".app-body")?.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      const target = keyboard ? "youtube:query" : channel ? refreshKey : "youtube:search-open";
      void setFocus(target, { skipScroll: true });
      return false;
    }
    const frame = grid.getBoundingClientRect();
    const card = focused.getBoundingClientRect();
    if (direction === "down") {
      if (moreError?.cursor !== cursor && frame.bottom - card.bottom < card.height + 40) void appendPage();
      return true;
    }
    if (card.left > frame.left + 12) return true;
    resetScroll();
    void setFocus("youtube:kbd", { skipScroll: true });
    return false;
  };

  const moveToResults = () => {
    const first = list?.[0];
    if (!first) return false;
    if (keyboard) resetScroll();
    void setFocus("youtube:video:" + first.id, { skipScroll: keyboard });
    return true;
  };

  const backAction = { label: "Назад на главную YouTube", onPress: backToYoutube };
  const historyAction = watchHistory ? (
    <Focusable as="button" className="home-round" focusKey="youtube:history-back" scroll={false} back
      aria-label={backAction.label} title={backAction.label}
      onArrowPress={(direction) => direction !== "down" || !moveToResults()} onPress={backAction.onPress}>
      <BackIcon size={24} strokeWidth={2.2} />
    </Focusable>
  ) : (
    <Focusable as="button" className="home-round" focusKey="youtube:history" scroll={false}
      aria-label="История просмотров" title="История просмотров"
      onArrowPress={(direction) => direction !== "down" || !moveToResults()}
      onPress={() => {
        historyView = undefined;
        navigate({ name: "youtube", watchHistory: true }, "youtube:history");
      }}>
      <History size={24} aria-hidden="true" />
    </Focusable>
  );

  const refreshLabel = searching ? "Обновить результаты" : watchHistory ? "Обновить историю" : channel ? "Обновить канал" : "Обновить рекомендации";

  return (
    <>
      <HomeChrome id="youtube" label={channel ? "Канал YouTube" : "YouTube"} hideSearch
        backAction={channel || watchHistory ? backAction : undefined} />
      <div className={"sx yt-main" + (keyboard ? " yt-main--search" : "")} data-wide={wide}>
        <div className="yt-toolbar">
          {channel ? (
            <div className="yt-channel sx__field">
              <KxChannelLogo src={feed?.author?.avatar} fallbackSrc={channel.avatar} name={feed?.author?.name || channel.name} />
              <h1>{feed?.author?.name || channel.name || "Канал YouTube"}</h1>
            </div>
          ) : keyboard ? (
            <TextField type="search" className="sx__field yt-query-input" focusKey="youtube:query" value={draft}
              icon={<SearchIcon size={44} />} onChange={changeQuery} onSubmit={submitSearch} placeholder="Поиск видео на YouTube" />
          ) : (
            <Focusable as="button" focusKey="youtube:search-open" autoFocus={autofocus && !watchHistory} className="sx__field yt-search"
              onArrowPress={(direction) => direction !== "down" || !moveToResults()} onPress={openSearch}>
              <SearchIcon size={44} /> <span className="sx__query is-placeholder">Поиск видео на YouTube</span>
            </Focusable>
          )}
          {keyboard && (
            <Focusable as="button" className="sx__chip" focusKey="youtube:home" onPress={showHome}>Закрыть поиск</Focusable>
          )}
          {isTauri && (
            <div className="home__chrome-right yt-toolbar__actions">
              <Focusable as="button" className={"home-round yt-refresh" + (busy ? " is-refreshing" : "")}
                focusKey={refreshKey} autoFocus={autofocus && !!(channel || watchHistory) && !keyboard}
                aria-label={refreshLabel} title={refreshLabel} scroll={false}
                onArrowPress={(direction) => direction !== "down" || !moveToResults()}
                onPress={busy ? undefined : () => void (searching ? search(query) : refresh(!channel && !watchHistory))}>
                <RotateCw size={24} aria-hidden="true" />
              </Focusable>
              {historyAction}
            </div>
          )}
        </div>
        <div className="sx__rule" />

        {isTauri ? (
          <div className={"sx__cols yt-columns" + (keyboard ? " yt-columns--search" : "")}>
            {keyboard && (
              <FocusGroup focusKey="youtube:kbd" className="sx__kbd yt-search-keys" preferredChildFocusKey="youtube:lang">
                <SearchKeys prefix="youtube" mode={mode} scroll autoFocus={autofocus}
                  onRight={moveToResults}
                  onModeChange={(value) => { saved.mode = value; setMode(value); }}
                  onType={(key) => { playCategorySound("typing"); changeQuery(draft + key); }}
                  onErase={() => { playCategorySound("typing"); changeQuery(Array.from(draft).slice(0, -1).join("")); }}
                  onClear={() => changeQuery("")}
                />
              </FocusGroup>
            )}
            <FocusContext.Provider value={side.focusKey}>
            <section ref={side.ref} className="yt-content" aria-label={title}>
              {needsAccount ? (
                <p className="yt-empty" role="status">
                  {feed?.expired ? feed.error ?? "Подключите аккаунт YouTube заново в «Настройки → Источники»."
                    : watchHistory ? "Подключите аккаунт YouTube в «Настройки → Источники», чтобы увидеть историю просмотров."
                    : "Подключите аккаунт в «Настройки → Источники», чтобы увидеть персональные рекомендации."}
                </p>
              ) : busy && !list?.length ? (
                <div className="yt-loading" role="status"><Spinner /><span>Загрузка</span></div>
              ) : channel ? <h2 className="sx__label">{title}</h2> : <h1 className="sx__label">{title}</h1>}
              {contentError && <p className="yt-status yt-status--error" role="alert">{contentError}</p>}
              {!needsAccount && !busy && !contentError && !list?.length && (
                <p className="yt-status">
                  {watchHistory ? "История просмотров YouTube пуста." : channel ? "На этом канале пока нет доступных видео."
                    : searching ? "Видео по этому запросу не найдены." : "YouTube пока не предложил видео для этой ленты."}
                </p>
              )}
              {!!list?.length && (
                <FocusGroup focusKey="youtube:videos" className="yt-grid">
                  <FocusHighlight pad={4} radius={18} />
                  {list.map((video) => {
                    const author = channel ? feed?.author?.name || channel.name : video.channel;
                    const avatar = channel ? feed?.author?.avatar : video.avatar;
                    const metadata = [author, ...(video.details ?? [])].filter(Boolean).join(" · ");
                    return (
                      <Focusable as="button" key={video.id} focusKey={"youtube:video:" + video.id} className="yt-video" scrollBlock="nearest"
                        onArrowPress={moveFromResults} onFocus={() => prefetch(video)} onPress={() => void openVideo(video)}>
                        <span className="yt-video__image">
                          <img src={"https://i.ytimg.com/vi/" + video.id + "/hqdefault.jpg"} alt="" loading="lazy" referrerPolicy="no-referrer" />
                          {video.isLive ? <span className="yt-video__live">В эфире</span> : video.duration && <span>{video.duration}</span>}
                        </span>
                        <span className="yt-video__body">
                          <KxChannelLogo src={avatar} fallbackSrc={channel?.avatar} name={author || "YouTube"} lazy />
                          <span className="yt-video__text">
                            <strong title={video.title}>{video.title}</strong>
                            {metadata && <small>{metadata}</small>}
                          </span>
                        </span>
                      </Focusable>
                    );
                  })}
                </FocusGroup>
              )}
              {cursor && (
                <div ref={moreRef} className="yt-more">
                  {loadingMore === cursor && (
                    <div className="yt-more__loading" role="status"><Spinner /><span>Загрузка</span></div>
                  )}
                  {moreError?.cursor === cursor && (
                    <>
                      <p className="yt-status--error" role="alert">{moreError.message}</p>
                      <Focusable as="button" className="sx__chip" focusKey="youtube:retry-more" onPress={() => {
                        const last = list?.[list.length - 1];
                        if (last) void setFocus("youtube:video:" + last.id, { restore: true });
                        void appendPage();
                      }}>
                        Повторить загрузку
                      </Focusable>
                    </>
                  )}
                </div>
              )}
            </section>
            </FocusContext.Provider>
          </div>
        ) : <p className="yt-status">Для поиска и воспроизведения откройте раздел в приложении KINONYX.</p>}
      </div>

      {playback && (
        <Modal focusKey="youtube:play-dialog"
          className={playback.error ? "yt-dialog" : "trailer-resolving__card yt-play-loading"}
          onClose={closePlayback}>
          {playback.error ? (
            <>
              <h2>{playback.video.title}</h2>
              <p role="alert">{playback.error}</p>
              <div className="yt-dialog__actions">
                <Focusable as="button" className="yt-button" focusKey="youtube:play-external" scrollBlock="nearest"
                  onPress={() => void openExternal(VIDEO_URL + playback.video.id)}>Смотреть в браузере</Focusable>
                <Focusable as="button" className="yt-button" focusKey="youtube:cancel-play" autoFocus scrollBlock="nearest" back
                  onPress={closePlayback}>Закрыть</Focusable>
              </div>
            </>
          ) : <YoutubePlaybackLoading />}
        </Modal>
      )}
    </>
  );
}
