import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { doesFocusableExist, getCurrentFocusKey, setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { BackIcon, cancelGlides, Focusable, FocusGroup, NextIcon, onBack } from "@kinonyx/ui";
import { HomeChrome } from "../components/HomeChrome";
import { CycleRow } from "../components/CycleRow";
import { DLSS_OPTIONS } from "../data/playerOptions";
import { ASPECT_LABELS, ASPECT_MODES, useApp } from "../store/app";
import {
  configStatus,
  setKinopoiskApiKey,
  setMetadataSource,
  setTmdbApiKey,
  setTmdbApiMirror,
  setTorApiBaseUrl,
  setYoutubeCookiesBrowser,
  type ConfigStatus,
  type MetadataSource,
  type YoutubeCookiesBrowser,
} from "../data/api";
import { TextField } from "../components/TextField";
import { LinksModal } from "../components/LinksModal";
import { ANIMATED_KINDS, BG_PALETTES, EXCLUSIVE_KINDS, PLAIN_KINDS } from "../data/backgrounds";
import { applyThemeKit } from "../data/sounds";
import { SoundKitRow } from "../components/SoundKitRow";
import { MUSIC_CREDITS } from "../data/music";
import { VolumeRow } from "../components/VolumeRow";
import { TranslatorSettings } from "../components/TranslatorSettings";
import type { EpgRefreshInterval } from "../store/app";
import { rematchAll } from "../data/rematch";
import { AboutIcon, ChannelsIcon, FolderIcon, GearIcon, PhoneIcon, PlayerSettingsIcon, SourcesIcon, StatsIcon, SubtitlesIcon, ThemeIcon, VolumeIcon } from "@kinonyx/ui";
import { refreshRemoteInfo, useRemote } from "../store/remote";
import { StatsPanel } from "../components/StatsPanel";
import { StoragePanel } from "../components/StoragePanel";
import { resetScroll, RESTORE_DETAILS } from "../data/focusRestore";
import { useUpdater } from "../store/updater";
import { isTauri, openExternal } from "../data/io";
import { importYoutubeCookies } from "../data/youtube";
import { exportUserData, importUserData, openUserDataDir } from "../data/userdata";
import { getJacredKey, getJacredUrl, setJacred } from "../data/jacred";
import { lastSpeed, recommendQuality, runSpeedTest } from "../data/speedtest";
import { SCREENSAVER_OPTIONS, useScreensaver } from "../components/Screensaver";
import { introEnabled, setIntroEnabled } from "../components/IntroSplash";
import { listAudioDevices, resolveAudioDevice, type AudioDevice } from "../data/audioDevices";
import { listMonitors, moveToMonitor, readMonitor, readStartFullscreen, writeMonitor, writeStartFullscreen, type MonitorChoice } from "../data/windowPrefs";

/** Whole-program zoom steps; 100% is the design size (a Full HD screen — 4K screens are brought to it by themselves) and the default. */
const ZOOM_OPTIONS = [
  { value: 0.75, label: "75%" },
  { value: 0.9, label: "90%" },
  { value: 1, label: "100%" },
  { value: 1.15, label: "115%" },
  { value: 1.3, label: "130%" },
  { value: 1.5, label: "150%" },
  { value: 1.75, label: "175%" },
  { value: 2, label: "200%" },
];
const UI_SCALE_OPTIONS = [
  { value: 0.85, label: "Мелко" },
  { value: 1, label: "Обычно" },
  { value: 1.2, label: "Крупно" },
  { value: 1.4, label: "Очень крупно" },
];
const AUTO_HIDE_OPTIONS = [
  { value: 2, label: "2 с" },
  { value: 4, label: "4 с" },
  { value: 8, label: "8 с" },
  { value: 0, label: "Не скрывать" },
];
const SUBTITLE_SIZE_OPTIONS = [
  { value: 0.8, label: "Мелкие" },
  { value: 1, label: "Обычные" },
  { value: 1.4, label: "Крупные" },
  { value: 1.8, label: "Огромные" },
];
const UPSCALE_OPTIONS = [
  { value: "default", label: "Обычное" },
  { value: "sharp", label: "Чёткое" },
  { value: "max", label: "Максимум" },
] as const;
const TONE_OPTIONS = [
  { value: "auto", label: "Авто" },
  { value: "soft", label: "Мягкий" },
  { value: "contrast", label: "Контрастный" },
] as const;
const SUBTITLE_COLOR_OPTIONS = [
  { value: "#FFFFFF", label: "Белые" },
  { value: "#FFE45C", label: "Жёлтые" },
  { value: "#7CFF9B", label: "Зелёные" },
  { value: "#7CD7FF", label: "Голубые" },
];

type Note = { kind: "ok" | "error"; text: string } | null;

const DEV_LINKS = [
  {
    key: "site",
    title: "Портфолио",
    hint: "kidencedev.vercel.app",
    url: "https://kidencedev.vercel.app/",
  },
  {
    key: "tg",
    title: "Telegram-канал",
    hint: "t.me/kidencedev",
    url: "https://t.me/kidencedev",
  },
];

const EPG_REFRESH_OPTIONS: { key: EpgRefreshInterval; label: string }[] = [
  { key: "always", label: "Каждый раз" },
  { key: "day", label: "Раз в день" },
  { key: "week", label: "Раз в неделю" },
];

const COOKIES_OPTIONS: { key: YoutubeCookiesBrowser; label: string }[] = [
  { key: "", label: "Выключено" },
  { key: "chrome", label: "Chrome" },
  { key: "edge", label: "Edge" },
  { key: "firefox", label: "Firefox" },
];

const SOURCE_OPTIONS: { key: MetadataSource; label: string }[] = [
  { key: "kinopoisk", label: "Kinopoisk" },
  { key: "tmdb", label: "TMDB" },
];

const KP_KEY_URL = "https://kinopoiskapiunofficial.tech/profile";
const TMDB_KEY_URL = "https://www.themoviedb.org/settings/api";

type TabKey = "sources" | "player" | "channels" | "translation" | "look" | "sound" | "remote" | "storage" | "stats" | "about";

const BIG = { size: 300, strokeWidth: 1 } as const;
const TABS: { key: TabKey; label: string; icon: ReactNode; bigIcon: ReactNode }[] = [
  { key: "sources", label: "Источники", icon: <SourcesIcon size={22} />, bigIcon: <SourcesIcon {...BIG} /> },
  { key: "player", label: "Плеер", icon: <PlayerSettingsIcon size={22} />, bigIcon: <PlayerSettingsIcon {...BIG} /> },
  { key: "channels", label: "Каналы", icon: <ChannelsIcon size={22} />, bigIcon: <ChannelsIcon {...BIG} /> },
  { key: "translation", label: "Перевод и озвучка", icon: <SubtitlesIcon size={22} />, bigIcon: <SubtitlesIcon {...BIG} /> },
  { key: "look", label: "Оформление", icon: <ThemeIcon size={22} />, bigIcon: <ThemeIcon {...BIG} /> },
  { key: "sound", label: "Звук", icon: <VolumeIcon size={22} />, bigIcon: <VolumeIcon {...BIG} /> },
  { key: "remote", label: "Пульт", icon: <PhoneIcon size={22} />, bigIcon: <PhoneIcon {...BIG} /> },
  { key: "storage", label: "Хранилище", icon: <FolderIcon size={22} />, bigIcon: <FolderIcon {...BIG} /> },
  { key: "stats", label: "Статистика", icon: <StatsIcon size={22} />, bigIcon: <StatsIcon {...BIG} /> },
  { key: "about", label: "О программе", icon: <AboutIcon size={22} />, bigIcon: <AboutIcon {...BIG} /> },
];

const GROUPS: { title: string; keys: TabKey[] }[] = [
  { title: "ОСНОВНЫЕ", keys: ["sources", "player", "channels", "translation"] },
  { title: "ВНЕШНИЙ ВИД И ЗВУК", keys: ["look", "sound"] },
  { title: "ПРИЛОЖЕНИЕ", keys: ["remote", "storage", "stats", "about"] },
];

export function SettingsScreen() {
  const navigate = useApp((s) => s.navigate);
  const showStats = useApp((s) => s.showStreamStats);
  const setShowStats = useApp((s) => s.setShowStreamStats);
  const clickSparkEnabled = useApp((s) => s.clickSparkEnabled);
  // «Данные»: the answer of the last export / import, and the "press again" guard of the import (it replaces everything).
  const [dataNote, setDataNote] = useState("");
  const [speed, setSpeed] = useState(lastSpeed);
  const [speedBusy, setSpeedBusy] = useState(false);
  const [speedNote, setSpeedNote] = useState("");
  // The second source of releases (a JacRed server): saved as it is typed.
  const [tmdbMirror, setTmdbMirror] = useState("");
  const [jacUrl, setJacUrl] = useState(getJacredUrl);
  const [jacKey, setJacKey] = useState(getJacredKey);
  const [importArmed, setImportArmed] = useState(false);
  const screensaverSeconds = useScreensaver((s) => s.seconds);
  const setScreensaverSeconds = useScreensaver((s) => s.setSeconds);
  const [startFull, setStartFull] = useState(readStartFullscreen);
  const [introOn, setIntroOn] = useState(introEnabled);
  const [monitor, setMonitor] = useState(readMonitor);
  const [monitors, setMonitors] = useState<MonitorChoice[]>([]);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  useEffect(() => {
    void listMonitors().then(setMonitors, () => undefined);
    void listAudioDevices().then(setDevices, () => undefined);
  }, []);
  const uiZoom = useApp((s) => s.uiZoom);
  const setUiZoom = useApp((s) => s.setUiZoom);
  const setClickSparkEnabled = useApp((s) => s.setClickSparkEnabled);
  const backdropTrailer = useApp((s) => s.backdropTrailer);
  const setBackdropTrailer = useApp((s) => s.setBackdropTrailer);
  const backgroundKind = useApp((s) => s.backgroundKind);
  const setBackgroundKind = useApp((s) => s.setBackgroundKind);
  const sfxVolume = useApp((s) => s.sfxVolume);
  const setSfxVolume = useApp((s) => s.setSfxVolume);
  const musicEnabled = useApp((s) => s.musicEnabled);
  const setMusicEnabled = useApp((s) => s.setMusicEnabled);
  const musicVolume = useApp((s) => s.musicVolume);
  const playerDim = useApp((s) => s.playerDim);
  const setPlayerDim = useApp((s) => s.setPlayerDim);
  const playerPrefs = useApp((s) => s.playerPrefs);
  const audioDevice = useApp((s) => s.audioDevice);
  const setAudioDevice = useApp((s) => s.setAudioDevice);
  const setPlayerPrefs = useApp((s) => s.setPlayerPrefs);
  const setMusicVolume = useApp((s) => s.setMusicVolume);
  const soundPinned = useApp((s) => s.soundPinned);
  const setSoundPinned = useApp((s) => s.setSoundPinned);
  const currentTrack = useApp((s) => s.currentTrack);
  const epgRefreshInterval = useApp((s) => s.epgRefreshInterval);
  const setEpgRefreshInterval = useApp((s) => s.setEpgRefreshInterval);

  const updStatus = useUpdater((s) => s.status);
  const updVersion = useUpdater((s) => s.update?.version);
  const updError = useUpdater((s) => s.error);
  const autoCheck = useUpdater((s) => s.autoCheck);
  const [appVersion, setAppVersion] = useState("1.1.5");
  useEffect(() => {
    if (!isTauri) return;
    void import("@tauri-apps/api/app").then((m) => m.getVersion()).then(setAppVersion, () => undefined);
  }, []);

  // No section is open at first: moving over the list only highlights, pressing (Enter / click)
  // opens one — until then the right side just says to pick a category.
  const [tab, setTab] = useState<TabKey | null>(null);
  // The big picture on the left follows the row you are on (or the open section).
  const [hovered, setHovered] = useState<TabKey | null>(null);
  const stageTab = tab ?? hovered;
  const stageKey = stageTab ?? "gear";
  const lastTab = useRef<TabKey>("sources");
  const pane = useRef<HTMLDivElement>(null);
  const panePositions = useRef<Partial<Record<TabKey, { key: string; top: number }>>>({});

  const selectTab = (key: TabKey) => {
    lastTab.current = key;
    resetScroll();
    setTab(key);
  };

  const closeTab = useCallback(() => {
    if (!tab) return;
    const key = getCurrentFocusKey();
    const current = pane.current?.querySelector("[data-fk].is-focused");
    if (key && current?.getAttribute("data-fk") === key && key !== "settings:pane-back") {
      panePositions.current[tab] = { key, top: pane.current?.closest(".app-body")?.scrollTop ?? 0 };
    }
    if (importArmed) {
      setImportArmed(false);
      setDataNote("");
    }
    resetScroll();
    setTab(null);
  }, [tab, importArmed]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!tab) {
        const key = `settings:tab:${lastTab.current}`;
        if (doesFocusableExist(key)) setFocus(key, RESTORE_DETAILS);
        return;
      }

      const rows = Array.from(pane.current?.querySelectorAll<HTMLElement>("[data-fk]") ?? []);
      const position = panePositions.current[tab];
      if (position && rows.some((row) => row.dataset.fk === position.key) && doesFocusableExist(position.key)) {
        const scroll = pane.current?.closest(".app-body");
        cancelGlides();
        if (scroll) scroll.scrollTop = position.top;
        setFocus(position.key, RESTORE_DETAILS);
        return;
      }

      const first = rows.find((row) => row.dataset.fk !== "settings:pane-back") ?? rows[0];
      if (first?.dataset.fk) setFocus(first.dataset.fk, { ...RESTORE_DETAILS, skipScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab]);

  useEffect(() => {
    if (!tab) return;
    return onBack(() => {
      closeTab();
      return true;
    });
  }, [tab, closeTab]);

  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [torapi, setTorapi] = useState("");
  const [key, setKey] = useState("");
  const [tmdbKey, setTmdbKey] = useState("");
  const [torapiNote, setTorapiNote] = useState<Note>(null);
  const [keyNote, setKeyNote] = useState<Note>(null);
  const [tmdbKeyNote, setTmdbKeyNote] = useState<Note>(null);
  const [youtubeCookieNote, setYoutubeCookieNote] = useState<Note>(null);
  const [youtubeCookieBusy, setYoutubeCookieBusy] = useState<"browser" | "file" | null>(null);
  const discordEnabled = useApp((s) => s.discordEnabled);
  const setDiscordEnabled = useApp((s) => s.setDiscordEnabled);
  const [creditOpen, setCreditOpen] = useState(false);
  const [musicCreditOpen, setMusicCreditOpen] = useState(false);

  useEffect(() => {
    configStatus().then((s) => {
      setStatus(s);
      setTorapi(s.torapi_base_url);
      setTmdbMirror(s.tmdb_api_mirror ?? "");
    });
  }, []);

  const saveTorapi = async (value: string) => {
    try {
      await setTorApiBaseUrl(value);
      setTorapiNote({ kind: "ok", text: "Сохранено" });
    } catch (e) {
      setTorapiNote({ kind: "error", text: String(e) });
    }
  };

  const saveKey = async (value: string) => {
    if (!value.trim()) return;
    try {
      await setKinopoiskApiKey(value);
      setKey("");
      setStatus(await configStatus());
      setKeyNote({ kind: "ok", text: "Ключ сохранён" });
    } catch (e) {
      setKeyNote({ kind: "error", text: String(e) });
    }
  };

  const saveTmdbKey = async (value: string) => {
    if (!value.trim()) return;
    try {
      await setTmdbApiKey(value);
      setTmdbKey("");
      setStatus(await configStatus());
      setTmdbKeyNote({ kind: "ok", text: "Ключ сохранён" });
    } catch (e) {
      setTmdbKeyNote({ kind: "error", text: String(e) });
    }
  };

  const switchCookies = async (browser: YoutubeCookiesBrowser) => {
    if ((status?.youtube_cookies_browser ?? "") === browser) return;
    await setYoutubeCookiesBrowser(browser);
    setStatus(await configStatus());
  };

  const chooseYoutubeCookies = async (source: "browser" | "file") => {
    if (youtubeCookieBusy) return;
    setYoutubeCookieBusy(source);
    setYoutubeCookieNote(null);
    try {
      if (await importYoutubeCookies(source)) {
        setYoutubeCookieNote({ kind: "ok", text: "Сессия YouTube сохранена" });
      }
    } catch (e) {
      setYoutubeCookieNote({ kind: "error", text: String(e) });
    } finally {
      setYoutubeCookieBusy(null);
    }
  };

  const switchSource = async (source: MetadataSource) => {
    if (status?.metadata_source === source) return;
    await setMetadataSource(source);
    useApp.getState().setMetadataSourceState(source);
    void rematchAll(source);
    setStatus(await configStatus());
  };

  return (
    <FocusGroup focusKey="settings" className="settings screen-pad home home--tv home--nohero settings--tv">
      <HomeChrome id="settings" label="Настройки" hideSearch />

      <div className="stx">
        <div className="stx__stage">
          <div className="stx__art" key={stageKey}>
            {stageTab ? TABS.find((t) => t.key === stageTab)!.bigIcon : <GearIcon size={300} strokeWidth={1} />}
          </div>
        </div>

        <div className="stx__list">
        {tab === null && (
          <nav aria-label="Разделы настроек">
            {GROUPS.map((g) => (
              <div className="stx__group" key={g.title}>
                <div className="stx__heading">{g.title}</div>
                {g.keys.map((k) => {
                  const t = TABS.find((x) => x.key === k)!;
                  return (
                    <Focusable
                      as="button"
                      key={t.key}
                      focusKey={`settings:tab:${t.key}`}
                      className="stx__row"
                      onFocus={() => setHovered(t.key)}
                      onPress={() => selectTab(t.key)}
                      onArrowPress={(direction) => {
                        if (direction !== "right") return true;
                        selectTab(t.key);
                        return false;
                      }}
                    >
                      <span className="stx__row-icon">{t.icon}</span>
                      <span className="stx__row-label">{t.label}</span>
                      <NextIcon size={22} />
                    </Focusable>
                  );
                })}
              </div>
            ))}
          </nav>
        )}
        <div className="settings-pane" ref={pane} key={tab ?? "none"}>
        {tab !== null && (
          <Focusable as="button" back focusKey="settings:pane-back" className="stx__row stx__back" onPress={closeTab}>
            <span className="stx__row-icon">
              <BackIcon size={22} />
            </span>
            <span className="stx__row-label">Назад к настройкам</span>
          </Focusable>
        )}
        {tab === "sources" && (
          <>
            <section className="settings__item">
              <div className="settings__label">Источник метаданных</div>
              <CycleRow
                label="Источник"
                heading="Источник метаданных"
                focusKey="settings:source:0"
                options={SOURCE_OPTIONS.map((opt) => ({ value: opt.key, label: opt.label }))}
                value={status?.metadata_source ?? "kinopoisk"}
                onChange={switchSource}
              />
            </section>
            <section className="settings__item">
              <div className="settings__label">API-KEY KINOPOISKUNOFFICIAL</div>
              <TextField
                focusKey="settings:kpkey"
                value={key}
                onChange={(v) => {
                  setKey(v);
                  setKeyNote(null);
                }}
                onSubmit={(v) => void saveKey(v)}
                placeholder={
                  status?.kinopoisk_key_masked
                    ? `Сейчас: ${status.kinopoisk_key_masked} — введите новый, чтобы заменить`
                    : "Вставьте ключ с kinopoiskapiunofficial.tech"
                }
              />
              <SettingStatus note={keyNote} />
              <Focusable
                as="button"
                className="btn settings__site-btn"
                focusKey="settings:kpkey-site"
                onPress={() => void openExternal(KP_KEY_URL)}
              >
                Получить ключ на сайте
              </Focusable>
            </section>
            <section className="settings__item">
              <div className="settings__label">API-KEY TMDB</div>
              <TextField
                focusKey="settings:tmdbkey"
                value={tmdbKey}
                onChange={(v) => {
                  setTmdbKey(v);
                  setTmdbKeyNote(null);
                }}
                onSubmit={(v) => void saveTmdbKey(v)}
                placeholder={
                  status?.tmdb_key_masked
                    ? `Сейчас: ${status.tmdb_key_masked} — введите новый, чтобы заменить`
                    : "Вставьте ключ с themoviedb.org/settings/api"
                }
              />
              <SettingStatus note={tmdbKeyNote} />
              <Focusable
                as="button"
                className="btn settings__site-btn"
                focusKey="settings:tmdbkey-site"
                onPress={() => void openExternal(TMDB_KEY_URL)}
              >
                Получить ключ на сайте
              </Focusable>
            </section>
            <section className="settings__item">
              <div className="settings__label">Зеркало TMDB API (необязательно)</div>
              <TextField
                focusKey="settings:tmdbmirror"
                value={tmdbMirror}
                onChange={setTmdbMirror}
                onSubmit={(v) => void setTmdbApiMirror(v).catch(() => undefined)}
                placeholder="Адрес зеркала: https://…/3"
                type="url"
              />
            </section>
            <section className="settings__item">
              <div className="settings__label">Ссылка на TorAPI</div>
              <TextField
                focusKey="settings:torapi"
                value={torapi}
                onChange={(v) => {
                  setTorapi(v);
                  setTorapiNote(null);
                }}
                onSubmit={(v) => void saveTorapi(v)}
                placeholder="https://…"
                type="url"
              />
              <SettingStatus note={torapiNote} />
            </section>
            <section className="settings__item">
              <div className="settings__label">JacRed — ещё один источник раздач (необязательно)</div>
              <TextField
                focusKey="settings:jacred"
                value={jacUrl}
                onChange={(v) => {
                  setJacUrl(v);
                  setJacred(v, jacKey);
                }}
                placeholder="Адрес сервера JacRed: https://…"
                type="url"
              />
              <TextField
                focusKey="settings:jacredkey"
                value={jacKey}
                onChange={(v) => {
                  setJacKey(v);
                  setJacred(jacUrl, v);
                }}
                placeholder="Ключ (apikey), если сервер его требует"
              />
            </section>
            <section className="settings__item">
              <div className="settings__label">Cookies YouTube для трейлеров</div>
              <CycleRow
                label="Браузер"
                focusKey="settings:cookies:0"
                options={COOKIES_OPTIONS.map((opt) => ({ value: opt.key, label: opt.label }))}
                value={(status?.youtube_cookies_browser ?? "")}
                onChange={switchCookies}
              />
            </section>
            {isTauri && (
              <section className="settings__item">
                <div className="settings__label">Cookies для раздела YouTube</div>
                <Focusable
                  as="button"
                  className="btn settings__site-btn"
                  focusKey="settings:youtube-cookies-browser"
                  onPress={() => void chooseYoutubeCookies("browser")}
                >
                  {youtubeCookieBusy === "browser" ? "Проверяем сессию…" : "Использовать сессию из браузера"}
                </Focusable>
                <Focusable
                  as="button"
                  className="btn settings__site-btn"
                  focusKey="settings:youtube-cookies-import"
                  onPress={() => void chooseYoutubeCookies("file")}
                >
                  {youtubeCookieBusy === "file" ? "Проверяем сессию…" : "Импортировать cookies.txt"}
                </Focusable>
                <SettingStatus note={youtubeCookieNote} />
              </section>
            )}
          </>
        )}
        {tab === "player" && (
          <>
            <section className="settings__item">
              <div className="settings__label">Затемнение в плеере</div>
              <VolumeRow
                focusKey="settings:playerDim"
                volume={playerDim}
                onChange={setPlayerDim}
                step={0.05}
                format={(v) => (v === 0.5 ? "100% · стандарт" : `${Math.round(v * 200)}%`)}
              />
            </section>
            <section className="settings__item">
              <div className="settings__label">Размер кнопок плеера</div>
              <CycleRow
                label="Размер"
                heading="Размер кнопок плеера"
                focusKey="settings:uiscale:0"
                options={UI_SCALE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={playerPrefs.uiScale}
                onChange={(v) => setPlayerPrefs({ uiScale: v })}
              />
            </section>
            <section className="settings__item">
              <div className="settings__label">Скрывать кнопки плеера через</div>
              <CycleRow
                label="Скрывать через"
                heading="Скрывать кнопки плеера через"
                focusKey="settings:autohide:0"
                options={AUTO_HIDE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={playerPrefs.autoHideSec}
                onChange={(v) => setPlayerPrefs({ autoHideSec: v })}
              />
            </section>
            <section className="settings__item">
              <div className="settings__label">Заставка и титры</div>
              <CycleRow
                label="Пропуск"
                heading="Пропуск заставки и титров"
                focusKey="settings:skipmode:0"
                options={[
                  { value: "button" as const, label: "Кнопкой" },
                  { value: "auto" as const, label: "Сам" },
                  { value: "off" as const, label: "Выключен" },
                ]}
                value={playerPrefs.skipMode}
                onChange={(v) => setPlayerPrefs({ skipMode: v })}
              />
            </section>
            <section className="settings__item">
              <div className="settings__label">Субтитры</div>
              <CycleRow
                label="Размер"
                heading="Размер субтитров"
                focusKey="settings:subsize:0"
                options={SUBTITLE_SIZE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={playerPrefs.subtitleScale}
                onChange={(v) => setPlayerPrefs({ subtitleScale: v })}
              />
              <CycleRow
                label="Цвет"
                heading="Цвет субтитров"
                focusKey="settings:subcolor:0"
                options={SUBTITLE_COLOR_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={playerPrefs.subtitleColor}
                onChange={(v) => setPlayerPrefs({ subtitleColor: v })} swatch={(v) => String(v)}
              />
            </section>
            <section className="settings__item">
              <div className="settings__label">Соотношение сторон</div>
              <CycleRow
                label="Картинка"
                heading="Соотношение сторон"
                focusKey="settings:aspect:0"
                options={ASPECT_MODES.map((m) => ({ value: m, label: ASPECT_LABELS[m] }))}
                value={playerPrefs.aspect}
                onChange={(v) => setPlayerPrefs({ aspect: v })}
              />
            </section>
            <section className="settings__item">
              <div className="settings__label">Картинка</div>
              <div className="settings__sublabel">Масштабирование</div>
              <CycleRow
                label="Режим"
                heading="Масштабирование видео"
                focusKey="settings:upscale:0"
                options={UPSCALE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={playerPrefs.upscale}
                onChange={(v) => setPlayerPrefs({ upscale: v })}
              />
              <div className="settings__sublabel">HDR на обычном экране</div>
              <CycleRow
                label="Режим"
                heading="HDR на обычном экране"
                focusKey="settings:tone:0"
                options={TONE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={playerPrefs.toneMapping}
                onChange={(v) => setPlayerPrefs({ toneMapping: v })}
              />
              <div className="settings__sublabel">Обработка видео</div>
              <Focusable
                as="button"
                className={`checkbox ${playerPrefs.deband ? "is-on" : ""}`}
                focusKey="settings:deband"
                onPress={() => setPlayerPrefs({ deband: !playerPrefs.deband })}
              >
                <span className="checkbox__box">
                  {playerPrefs.deband && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                Сглаживать полосы на градиентах
              </Focusable>
              <Focusable
                as="button"
                className={`checkbox ${playerPrefs.smooth ? "is-on" : ""}`}
                focusKey="settings:smooth"
                onPress={() => setPlayerPrefs({ smooth: !playerPrefs.smooth })}
              >
                <span className="checkbox__box">
                  {playerPrefs.smooth && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                Плавность движения (смешивание кадров)
              </Focusable>
            </section>
            {isTauri && (
              <section className="settings__item">
                <CycleRow
                  label="DLSS Frame Generation"
                  focusKey="settings:frameGeneration:0"
                  options={DLSS_OPTIONS}
                  value={playerPrefs.frameGeneration}
                  onChange={async (multiplier) => {
                    if (multiplier) await invoke("frame_generation_filter", { multiplier });
                    setPlayerPrefs({ frameGeneration: multiplier });
                  }}
                />
              </section>
            )}

            <section className="settings__item">
              <div className="settings__label">Подробная статистика</div>
              <Focusable
                as="button"
                className={`checkbox ${showStats ? "is-on" : ""}`}
                focusKey="settings:stats"
                onPress={() => setShowStats(!showStats)}
              >
                <span className="checkbox__box">
                  {showStats && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                Включить
              </Focusable>
            </section>
          </>
        )}
        {tab === "player" && (
          <section className="settings__item">
            <div className="settings__label">Скорость интернета</div>
            <Focusable
              as="button"
              className="cycle-row"
              focusKey="settings:speedtest"
              onPress={() => {
                if (speedBusy) return;
                setSpeedBusy(true);
                setSpeedNote("");
                runSpeedTest().then(
                  (r) => {
                    setSpeed(r);
                    setSpeedBusy(false);
                  },
                  (e) => {
                    setSpeedNote(e instanceof Error ? e.message : String(e));
                    setSpeedBusy(false);
                  },
                );
              }}
            >
              <span className="cycle-row__label">{speedBusy ? "Измеряю…" : "Проверить скорость"}</span>
              <span className="cycle-row__value">{speed ? `≈ ${Math.round(speed.mbit)} Мбит/с · ${recommendQuality(speed.mbit).text}` : ""}</span>
            </Focusable>
            {speedNote && <div className="settings__hint" role="status">{speedNote}</div>}
          </section>
        )}
        {tab === "channels" && (
          <>
            <section className="settings__item">
              <div className="settings__label">Обновление программы передач</div>
              <CycleRow
                label="Обновлять"
                heading="Обновление программы передач"
                focusKey="settings:epg:0"
                options={EPG_REFRESH_OPTIONS.map((opt) => ({ value: opt.key, label: opt.label }))}
                value={epgRefreshInterval}
                onChange={(v) => setEpgRefreshInterval(v)}
              />
            </section>
          </>
        )}
        {tab === "translation" && <TranslatorSettings />}
        {tab === "look" && (
          <>
            {[
              { title: "Тема", kinds: PLAIN_KINDS },
              { title: "Анимированный фон", kinds: ANIMATED_KINDS },
              { title: "Эксклюзивные темы", kinds: EXCLUSIVE_KINDS },
            ].map((group) => (
              <section className="settings__item" key={group.title}>
                <div className="settings__label">{group.title}</div>
                <div className="sound-options">
                  {group.kinds.map((kind) => {
                    const palette = BG_PALETTES[kind];
                    return (
                      <Focusable
                        as="button"
                        key={kind}
                        focusKey={`settings:bg:${kind}`}
                        className={`sound-option ${backgroundKind === kind ? "is-active" : ""}`}
                        onPress={() => {
                          setBackgroundKind(kind);
                          applyThemeKit(kind);
                        }}
                      >
                        <i
                          className="swatch"
                          style={{
                            background:
                              kind === "bw"
                              ? "linear-gradient(135deg, #ffffff 0%, #000000 100%)"
                              : `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accentDeep} 100%)`,
                          }}
                        />
                        {palette.label}
                      </Focusable>
                    );
                  })}
                </div>
              </section>
            ))}
            <section className="settings__item">
              <div className="settings__label">Окно</div>
              <Focusable
                as="button"
                className={`checkbox ${startFull ? "is-on" : ""}`}
                focusKey="settings:startFullscreen"
                onPress={() => {
                  const on = !startFull;
                  setStartFull(on);
                  writeStartFullscreen(on);
                }}
              >
                <span className="checkbox__box">
                  {startFull && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                Запускать в полном экране
              </Focusable>
              <Focusable
                as="button"
                className={`checkbox ${introOn ? "is-on" : ""}`}
                focusKey="settings:introOnStart"
                onPress={() => {
                  const on = !introOn;
                  setIntroOn(on);
                  setIntroEnabled(on);
                }}
              >
                <span className="checkbox__box">
                  {introOn && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                Заставка KINONYX при запуске
              </Focusable>
              {monitors.length > 2 && (
                <CycleRow
                  label="Экран программы"
                  focusKey="settings:monitor:0"
                  options={monitors.map((m) => ({ value: m.value, label: m.label }))}
                  value={monitor}
                  onChange={(v) => {
                    setMonitor(v);
                    writeMonitor(v);
                    void moveToMonitor(v);
                  }}
                />
              )}
              <CycleRow
                label="Заставка при простое"
                focusKey="settings:screensaver:0"
                options={SCREENSAVER_OPTIONS.map((m) => ({ value: m, label: m === 0 ? "Выключена" : m < 60 ? `Через ${m} сек` : `Через ${m / 60} мин` }))}
                value={screensaverSeconds}
                onChange={setScreensaverSeconds}
              />
            </section>
            <section className="settings__item">
              <div className="settings__label">Интерфейс</div>
              <CycleRow
                label="Масштаб программы"
                focusKey="settings:zoom:0"
                options={ZOOM_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={uiZoom}
                onChange={(v) => setUiZoom(v)}
              />
              <Focusable
                as="button"
                className={`checkbox ${clickSparkEnabled ? "is-on" : ""}`}
                focusKey="settings:clickSpark"
                onPress={() => setClickSparkEnabled(!clickSparkEnabled)}
              >
                <span className="checkbox__box">
                  {clickSparkEnabled && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                Искры при клике мышью
              </Focusable>
              <Focusable
                as="button"
                className={`checkbox ${backdropTrailer ? "is-on" : ""}`}
                focusKey="settings:backdropTrailer"
                onPress={() => setBackdropTrailer(!backdropTrailer)}
              >
                <span className="checkbox__box">
                  {backdropTrailer && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                Трейлер на фоне страницы фильма
              </Focusable>
            </section>
          </>
        )}
        {tab === "sound" && (
          <>
            <section className="settings__item">
              <div className="settings__label">Вывод звука</div>
              <CycleRow
                label="Устройство"
                heading="Устройство вывода звука"
                focusKey="settings:audiodevice:0"
                options={[{ value: "auto", label: "По умолчанию в Windows" }, ...devices.filter((d) => d.name !== "auto").map((d) => ({ value: d.name, label: d.description }))]}
                value={resolveAudioDevice(audioDevice, devices)}
                onChange={(v) => setAudioDevice(v === "auto" ? "" : v)}
              />
            </section>
            <section className="settings__item">
              <div className="settings__label">Воспроизведение</div>
              <Focusable
                as="button"
                className={`checkbox ${playerPrefs.nightMode ? "is-on" : ""}`}
                focusKey="settings:nightmode"
                onPress={() => setPlayerPrefs({ nightMode: !playerPrefs.nightMode })}
              >
                <span className="checkbox__box">
                  {playerPrefs.nightMode && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                Ночной режим
              </Focusable>
            </section>
            <section className="settings__item">
              <div className="settings__label">Набор звуков</div>
              <SoundKitRow focusPrefix="settings:snd:kit" />
            </section>
            <section className="settings__item">
              <div className="settings__label">Громкость звуков</div>
              <VolumeRow
                focusKey="settings:snd:volume"
                volume={sfxVolume}
                onChange={setSfxVolume}
              />
            </section>
            <section className="settings__item">
              <div className="settings__label">Фоновая музыка</div>
              <Focusable
                as="button"
                className={`checkbox ${musicEnabled ? "is-on" : ""}`}
                focusKey="settings:music:on"
                onPress={() => setMusicEnabled(!musicEnabled)}
              >
                <span className="checkbox__box">
                  {musicEnabled && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                Проигрывать
              </Focusable>
              {musicEnabled && currentTrack && (
                <div className="settings__hint" role="status">Сейчас играет: {currentTrack.title} — {currentTrack.artist}</div>
              )}
            </section>
            <section className="settings__item">
              <div className="settings__label">Громкость музыки</div>
              <VolumeRow
                focusKey="settings:music:volume"
                volume={musicVolume}
                onChange={setMusicVolume}
              />
            </section>
            <section className="settings__item">
              <Focusable
                as="button"
                className="btn settings__site-btn"
                focusKey="settings:snd:apply"
                onPress={() => setSoundPinned(true)}
              >
                {soundPinned ? "Применено ✓" : "Применить"}
              </Focusable>
              {soundPinned && (
                <Focusable
                  as="button"
                  className="btn settings__site-btn"
                  focusKey="settings:snd:unpin"
                  onPress={() => setSoundPinned(false)}
                >
                  Снять закрепление
                </Focusable>
              )}
            </section>
          </>
        )}
        {tab === "remote" && <RemotePane />}
        {tab === "storage" && (
          <>
            <StoragePanel />
            <section className="settings__item">
              <div className="settings__label">Мои данные</div>
              <Focusable
                as="button"
                className="cycle-row"
                focusKey="settings:data-export"
                onPress={() => {
                  setImportArmed(false);
                  exportUserData().then(
                    (r) => setDataNote(r === "saved" ? "Данные сохранены в файл." : ""),
                    (e) => setDataNote(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`),
                  );
                }}
              >
                <span className="cycle-row__label">Сохранить данные в файл</span>
                <NextIcon size={20} />
              </Focusable>
              <Focusable
                as="button"
                className="cycle-row"
                focusKey="settings:data-import"
                onPress={() => {
                  if (!importArmed) {
                    setImportArmed(true);
                    setDataNote("Загрузка заменит избранное, прогресс и настройки на то, что в файле. Нажмите ещё раз, чтобы выбрать файл.");
                    return;
                  }
                  setImportArmed(false);
                  importUserData().then(
                    () => undefined,
                    (e) => setDataNote(`Не удалось загрузить: ${e instanceof Error ? e.message : String(e)}`),
                  );
                }}
              >
                <span className="cycle-row__label">Загрузить данные из файла</span>
                <span className="cycle-row__value">{importArmed ? "Нажмите ещё раз" : ""}</span>
                <NextIcon size={20} />
              </Focusable>
              <Focusable as="button" className="cycle-row" focusKey="settings:data-folder" onPress={() => void openUserDataDir()}>
                <span className="cycle-row__label">Папка с копией данных</span>
                <NextIcon size={20} />
              </Focusable>
              {dataNote && <div className="settings__hint" role="status">{dataNote}</div>}
            </section>
          </>
        )}
        {tab === "stats" && <StatsPanel />}
        {tab === "about" && (
          <>
            <section className="settings__item">
              <div className="settings__label">Обновления</div>
              <Focusable
                as="button"
                focusKey="settings:update-check"
                className="cycle-row"
                onPress={() => {
                  const u = useUpdater.getState();
                  if (u.status === "available") useUpdater.setState({ dismissed: false });
                  else void u.check(true);
                }}
              >
                <span className="cycle-row__label">
                  {updStatus === "available" ? `Установить ${updVersion}` : "Проверить обновления"}
                </span>
                <span className="cycle-row__value">
                  {updStatus === "checking" ? "Проверяю…" : updStatus === "uptodate" ? "Последняя версия" : appVersion}
                </span>
                <NextIcon size={20} />
              </Focusable>
              <Focusable
                as="button"
                className={`checkbox ${autoCheck ? "is-on" : ""}`}
                focusKey="settings:update-auto"
                onPress={() => useUpdater.getState().setAutoCheck(!autoCheck)}
              >
                <span className="checkbox__box">
                  {autoCheck && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                Проверять при запуске
              </Focusable>
              {(updStatus === "error" || updStatus === "available") && (
                <div className={`settings__hint ${updStatus === "error" ? "settings__hint--error" : ""}`}>
                  {updStatus === "error" ? updError : `Доступна версия ${updVersion}.`}
                </div>
              )}
            </section>

            <section className="settings__item">
              <div className="settings__label">Discord</div>
              <Focusable
                as="button"
                className={`checkbox ${discordEnabled ? "is-on" : ""}`}
                focusKey="settings:discord"
                onPress={() => setDiscordEnabled(!discordEnabled)}
              >
                <span className="checkbox__box">
                  {discordEnabled && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                Показывать, что я смотрю
              </Focusable>
            </section>

            <section className="settings__item">
              <div className="settings__label">Программа</div>
              <Focusable as="button" className="cycle-row" focusKey="settings:diagnostics" onPress={() => navigate({ name: "diagnostics" })}>
                <span className="cycle-row__label">Диагностика</span>
                <NextIcon size={20} />
              </Focusable>
              <Focusable as="button" className="cycle-row" focusKey="settings:rerun-setup" onPress={() => navigate({ name: "setup" })}>
                <span className="cycle-row__label">Пройти настройку заново</span>
                <NextIcon size={20} />
              </Focusable>
              <Focusable as="button" className="cycle-row" focusKey="settings:credit" onPress={() => setCreditOpen(true)}>
                <span className="cycle-row__label">Разработчик</span>
                <span className="cycle-row__value">kidencedev</span>
                <NextIcon size={20} />
              </Focusable>
              <Focusable as="button" className="cycle-row" focusKey="settings:music-credit" onPress={() => setMusicCreditOpen(true)}>
                <span className="cycle-row__label">Музыка</span>
                <span className="cycle-row__value">NCMFYT, C152, Affection Core</span>
                <NextIcon size={20} />
              </Focusable>
              <span className="settings__version">KINONYX {appVersion}</span>
            </section>
          </>
        )}
        </div>
        </div>
      </div>

      {creditOpen && (
        <LinksModal
          tv
          heading="kidencedev"
          empty=""
          links={DEV_LINKS}
          onClose={() => setCreditOpen(false)}
        />
      )}
      {musicCreditOpen && (
        <LinksModal
          tv
          heading="Музыка"
          empty=""
          links={MUSIC_CREDITS}
          onClose={() => setMusicCreditOpen(false)}
        />
      )}
    </FocusGroup>
  );
}

function SettingStatus({ note }: { note: Note }) {
  if (!note) return null;
  return (
    <div className={`settings__hint settings__hint--${note.kind}`} role="status">
      {note.text}
    </div>
  );
}

/** Settings → Пульт: the phone as a remote control (a QR code to scan, one switch). */
function RemotePane() {
  const enabled = useRemote((s) => s.enabled);
  const info = useRemote((s) => s.info);
  const error = useRemote((s) => s.error);
  const setEnabled = useRemote((s) => s.setEnabled);
  const renew = useRemote((s) => s.renew);
  useEffect(() => {
    void refreshRemoteInfo();
  }, []);
  return (
    <>
      <section className="settings__item">
        <div className="settings__label">Пульт с телефона</div>
        <Focusable
          as="button"
          className={`checkbox ${enabled ? "is-on" : ""}`}
          focusKey="settings:remote"
          onPress={() => void setEnabled(!enabled)}
        >
          <span className="checkbox__box">
            {enabled && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
          Включить пульт
        </Focusable>
        {error && <div className="settings__hint settings__hint--error">{error}</div>}
      </section>

      {enabled && info && (
        <section className="settings__item">
          <div className="settings__label">Код для телефона</div>
          <div className="remote-qr" dangerouslySetInnerHTML={{ __html: info.qr }} aria-label="QR-код пульта" />
          {info.urls.length === 0 ? (
            <div className="settings__hint settings__hint--error">Не нашёл адрес компьютера в домашней сети. Проверьте подключение к Wi-Fi.</div>
          ) : (
            <div className="settings__hint remote-urls">
              {info.urls.map((u) => (
                <div key={u}>{u.replace(/\?t=.*/, "")}</div>
              ))}
            </div>
          )}
          <Focusable as="button" className="btn settings__site-btn" focusKey="settings:remote:renew" onPress={() => void renew()}>
            Сменить код
          </Focusable>
        </section>
      )}
    </>
  );
}
