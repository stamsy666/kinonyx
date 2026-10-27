import { useEffect, useRef, useState, type ReactNode } from "react";
import { doesFocusableExist, setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { BackIcon, Focusable, FocusGroup, NextIcon, onBack } from "@kinonyx/ui";
import { HomeChrome } from "../components/HomeChrome";
import { CycleRow } from "../components/CycleRow";
import { ASPECT_LABELS, ASPECT_MODES, useApp } from "../store/app";
import {
  configStatus,
  setKinopoiskApiKey,
  setMetadataSource,
  setTmdbApiKey,
  setTorApiBaseUrl,
  setYoutubeCookiesBrowser,
  type ConfigStatus,
  type MetadataSource,
  type YoutubeCookiesBrowser,
} from "../data/api";
import { TextField } from "../components/TextField";
import { LinksModal } from "../components/LinksModal";
import { ANIMATED_KINDS, BG_PALETTES, EXCLUSIVE_KINDS, PLAIN_KINDS } from "../data/backgrounds";
import { applyThemeKit, SOUND_CATEGORIES, SOUND_CATEGORY_LABELS } from "../data/sounds";
import { SoundCategoryRow } from "../components/SoundCategoryRow";
import { SoundKitRow } from "../components/SoundKitRow";
import { MUSIC_CREDITS } from "../data/music";
import { VolumeRow } from "../components/VolumeRow";
import { TranslatorSettings } from "../components/TranslatorSettings";
import type { EpgRefreshInterval } from "../store/app";
import { rematchAll } from "../data/rematch";
import { AboutIcon, ChannelsIcon, GearIcon, PhoneIcon, PlayerSettingsIcon, SourcesIcon, StatsIcon, ThemeIcon, VolumeIcon } from "@kinonyx/ui";
import { refreshRemoteInfo, useRemote } from "../store/remote";
import { StatsPanel } from "../components/StatsPanel";
import { resetScroll } from "../data/focusRestore";
import { useUpdater } from "../store/updater";
import { isTauri, openExternal } from "../data/io";
import { exportUserData, importUserData, openUserDataDir } from "../data/userdata";
import { listAudioDevices, type AudioDevice } from "../data/audioDevices";
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

type TabKey = "sources" | "player" | "channels" | "look" | "sound" | "remote" | "stats" | "about";

const BIG = { size: 300, strokeWidth: 1 } as const;
const TABS: { key: TabKey; label: string; desc: string; icon: ReactNode; bigIcon: ReactNode }[] = [
  { key: "sources", label: "Источники", desc: "Ключи Кинопоиска и TMDB, адрес TorAPI и откуда брать каталог.", icon: <SourcesIcon size={22} />, bigIcon: <SourcesIcon {...BIG} /> },
  { key: "player", label: "Плеер", desc: "Затемнение, кнопки, субтитры, звук и картинка при просмотре.", icon: <PlayerSettingsIcon size={22} />, bigIcon: <PlayerSettingsIcon {...BIG} /> },
  { key: "channels", label: "Каналы", desc: "Программа передач и локальный перевод эфира.", icon: <ChannelsIcon size={22} />, bigIcon: <ChannelsIcon {...BIG} /> },
  { key: "look", label: "Оформление", desc: "Тема, масштаб программы и эффекты.", icon: <ThemeIcon size={22} />, bigIcon: <ThemeIcon {...BIG} /> },
  { key: "sound", label: "Звук", desc: "Звуки интерфейса, их громкость и фоновая музыка.", icon: <VolumeIcon size={22} />, bigIcon: <VolumeIcon {...BIG} /> },
  { key: "remote", label: "Пульт", desc: "Управление приложением с телефона по QR-коду.", icon: <PhoneIcon size={22} />, bigIcon: <PhoneIcon {...BIG} /> },
  { key: "stats", label: "Статистика", desc: "Сколько и что вы смотрели.", icon: <StatsIcon size={22} />, bigIcon: <StatsIcon {...BIG} /> },
  { key: "about", label: "О программе", desc: "Обновления, диагностика, Discord и авторы.", icon: <AboutIcon size={22} />, bigIcon: <AboutIcon {...BIG} /> },
];

const GROUPS: { title: string; keys: TabKey[] }[] = [
  { title: "ОСНОВНЫЕ", keys: ["sources", "player", "channels"] },
  { title: "ВНЕШНИЙ ВИД И ЗВУК", keys: ["look", "sound"] },
  { title: "ПРИЛОЖЕНИЕ", keys: ["remote", "stats", "about"] },
];

export function SettingsScreen() {
  const navigate = useApp((s) => s.navigate);
  const showStats = useApp((s) => s.showStreamStats);
  const setShowStats = useApp((s) => s.setShowStreamStats);
  const clickSparkEnabled = useApp((s) => s.clickSparkEnabled);
  // «Данные»: the answer of the last export / import, and the "press again" guard of the import (it replaces everything).
  const [dataNote, setDataNote] = useState("");
  const [importArmed, setImportArmed] = useState(false);
  const [startFull, setStartFull] = useState(readStartFullscreen);
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
  const selectTab = (key: TabKey) => {
    lastTab.current = key;
    setTab(key);
    // A new section starts at its top, whatever the previous one's scroll position was.
    resetScroll();
  };

  // Back from an open section returns to the list of sections (and to the row it was opened from).
  useEffect(() => {
    if (tab === null) {
      requestAnimationFrame(() => {
        if (doesFocusableExist(`settings:tab:${lastTab.current}`)) setFocus(`settings:tab:${lastTab.current}`);
      });
      return;
    }
    requestAnimationFrame(() => {
      const first = document.querySelectorAll<HTMLElement>(".settings-pane [data-fk]")[1] ?? document.querySelector<HTMLElement>(".settings-pane [data-fk]");
      if (first?.dataset.fk) setFocus(first.dataset.fk);
    });
    return onBack(() => {
      setTab(null);
      return true;
    });
  }, [tab]);

  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [torapi, setTorapi] = useState("");
  const [key, setKey] = useState("");
  const [tmdbKey, setTmdbKey] = useState("");
  const [torapiNote, setTorapiNote] = useState<Note>(null);
  const [keyNote, setKeyNote] = useState<Note>(null);
  const [tmdbKeyNote, setTmdbKeyNote] = useState<Note>(null);
  const discordEnabled = useApp((s) => s.discordEnabled);
  const setDiscordEnabled = useApp((s) => s.setDiscordEnabled);
  const [creditOpen, setCreditOpen] = useState(false);
  const [musicCreditOpen, setMusicCreditOpen] = useState(false);

  useEffect(() => {
    configStatus().then((s) => {
      setStatus(s);
      setTorapi(s.torapi_base_url);
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
          <p className="stx__desc">{stageTab ? TABS.find((t) => t.key === stageTab)!.desc : "Источники, плеер, оформление и звук."}</p>
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
                      autoFocus={t.key === TABS[0].key}
                      className="stx__row"
                      onFocus={() => setHovered(t.key)}
                      onPress={() => selectTab(t.key)}
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
        <div className="settings-pane" key={tab ?? "none"}>
        {tab !== null && (
          <Focusable as="button" back focusKey="settings:pane-back" className="stx__row stx__back" onPress={() => setTab(null)}>
            <span className="stx__row-icon">
              <BackIcon size={22} />
            </span>
            <span className="stx__row-label">Назад к настройкам</span>
          </Focusable>
        )}
        {tab === "sources" && (
          <>
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
              <Hint
                note={torapiNote}
                fallback="Enter — сохранить. Поиск раздач идёт через этот сервер."
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
              <Hint
                note={keyNote}
                fallback="Enter — сохранить. Ключ хранится только на этом компьютере."
              />
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
              <div className="settings__label">Источник метаданных</div>
              <CycleRow
                label="Источник"
                focusKey="settings:source:0"
                options={SOURCE_OPTIONS.map((opt) => ({ value: opt.key, label: opt.label }))}
                value={status?.metadata_source ?? "kinopoisk"}
                onChange={(v) => void switchSource(v)}
              />
              <div className="settings__hint">
                Kinopoisk — основной источник, с русскими названиями и локальным
                стримингом. TMDB — запасной вариант на случай, если у Kinopoisk
                кончился суточный лимит или он недоступен; кадров и похожих фильмов
                там обычно меньше. Для TMDB нужен включённый VPN.
              </div>
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
              <Hint
                note={tmdbKeyNote}
                fallback="Enter — сохранить. Нужен только если выбран источник TMDB выше."
              />
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
              <div className="settings__label">Cookies YouTube для трейлеров</div>
              <CycleRow
                label="Браузер"
                focusKey="settings:cookies:0"
                options={COOKIES_OPTIONS.map((opt) => ({ value: opt.key, label: opt.label }))}
                value={(status?.youtube_cookies_browser ?? "")}
                onChange={(v) => void switchCookies(v)}
              />
              <div className="settings__hint">
                Если YouTube отвечает «подтвердите, что вы не бот», трейлеры можно открыть
                через вашу сессию YouTube в выбранном браузере — нужно быть в нём
                залогиненным. Приложение читает только cookies YouTube, только при
                открытии трейлера и только на этом компьютере. Браузер при этом должен
                быть полностью закрыт.
              </div>
            </section>
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
              <div className="settings__hint">
                Насколько темнеет картинка, пока на экране кнопки плеера. Влево — светлее
                (0% — без затемнения), вправо — темнее.
              </div>
            </section>
            <section className="settings__item">
              <div className="settings__label">Размер кнопок плеера</div>
              <CycleRow
                label="Размер"
                focusKey="settings:uiscale:0"
                options={UI_SCALE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={playerPrefs.uiScale}
                onChange={(v) => setPlayerPrefs({ uiScale: v })}
              />
              <div className="settings__hint">Размер кнопок, названия и времени на экране плеера — для большого экрана или пульта издалека.</div>
            </section>
            <section className="settings__item">
              <div className="settings__label">Скрывать кнопки плеера через</div>
              <CycleRow
                label="Скрывать через"
                focusKey="settings:autohide:0"
                options={AUTO_HIDE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={playerPrefs.autoHideSec}
                onChange={(v) => setPlayerPrefs({ autoHideSec: v })}
              />
              <div className="settings__hint">Сколько секунд без нажатий кнопки остаются на экране.</div>
            </section>
            <section className="settings__item">
              <div className="settings__label">Соотношение сторон</div>
              <CycleRow
                label="Картинка"
                focusKey="settings:aspect:0"
                options={ASPECT_MODES.map((m) => ({ value: m, label: ASPECT_LABELS[m] }))}
                value={playerPrefs.aspect}
                onChange={(v) => setPlayerPrefs({ aspect: v })}
              />
              <div className="settings__hint">
                «Растянуть» заполняет окно, искажая картинку; «Заполнить» обрезает края вместо чёрных полос. В фильме можно сменить и в меню «Картинка».
              </div>
            </section>
            <section className="settings__item">
              <div className="settings__label">Субтитры</div>
              <CycleRow
                label="Размер"
                focusKey="settings:subsize:0"
                options={SUBTITLE_SIZE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={playerPrefs.subtitleScale}
                onChange={(v) => setPlayerPrefs({ subtitleScale: v })}
              />
              <CycleRow
                label="Цвет"
                focusKey="settings:subcolor:0"
                options={SUBTITLE_COLOR_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={playerPrefs.subtitleColor}
                onChange={(v) => setPlayerPrefs({ subtitleColor: v })} swatch={(v) => String(v)}
              />
              <div className="settings__hint">Размер и цвет текста субтитров применяются со следующего запуска видео.</div>
            </section>
            <section className="settings__item">
              <div className="settings__label">Звук</div>
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
              <div className="settings__hint">
                Выравнивает громкость: взрывы и музыка не оглушают, тихие реплики слышно. Применяется со следующего запуска видео.
              </div>
            </section>

            <section className="settings__item">
              <div className="settings__label">Картинка</div>
              <div className="settings__sublabel">Масштабирование</div>
              <CycleRow
                label="Режим"
                focusKey="settings:upscale:0"
                options={UPSCALE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={playerPrefs.upscale}
                onChange={(v) => setPlayerPrefs({ upscale: v })}
              />
              <div className="settings__sublabel">HDR на обычном экране</div>
              <CycleRow
                label="Режим"
                focusKey="settings:tone:0"
                options={TONE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={playerPrefs.toneMapping}
                onChange={(v) => setPlayerPrefs({ toneMapping: v })}
              />
              <Focusable
                as="button"
                className={`checkbox ${playerPrefs.deband ? "is-on" : ""}`}
                focusKey="settings:deband"
                onPress={() => setPlayerPrefs({ deband: !playerPrefs.deband })}
                style={{ marginTop: 16 }}
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
              <div className="settings__hint">
                «Чёткое» и «Максимум» делают картинку резче на видео ниже разрешения экрана, но нагружают видеокарту.
                «Мягкий» / «Контрастный» меняют, как HDR-фильмы выглядят на обычном экране; «Авто» оставляет решение плееру.
                Применяется со следующего запуска видео.
              </div>
            </section>

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
              <div className="settings__hint">
                Разрешение, FPS, битрейт, кодеки и буфер поверх видео в плеере.
              </div>
            </section>
          </>
        )}
        {tab === "channels" && (
          <>
            <section className="settings__item">
              <div className="settings__label">Обновление программы передач</div>
              <CycleRow
                label="Обновлять"
                focusKey="settings:epg:0"
                options={EPG_REFRESH_OPTIONS.map((opt) => ({ value: opt.key, label: opt.label }))}
                value={epgRefreshInterval}
                onChange={(v) => setEpgRefreshInterval(v)}
              />
              <div className="settings__hint">
                Как часто обновлять программу передач. Между обновлениями она хранится на диске, заходить в «Каналы» быстрее.</div>
            </section>
            <TranslatorSettings />
          </>
        )}
        {tab === "look" && (
          <>
            {[
              { title: "Тема", kinds: PLAIN_KINDS, hint: "" },
              { title: "Анимированный фон", kinds: ANIMATED_KINDS, hint: "Цвет интерфейса меняется вместе с фоном." },
              { title: "Эксклюзивные темы", kinds: EXCLUSIVE_KINDS, hint: "Вместе с темой меняются музыка и звуки (PS4 или PS5)." },
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
                {group.hint && <div className="settings__hint">{group.hint}</div>}
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
              <div className="settings__hint">
                {monitors.length > 2
                  ? "Программа откроется на выбранном экране и перенесётся на него сразу. Если экран отключён, окно откроется там, где обычно."
                  : "Полный экран при каждом запуске. Если подключить второй монитор, здесь появится выбор экрана."}
              </div>
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
              <div className="settings__hint">
                100% — как на экране Full HD, на 4K масштаб подбирается сам. Больше — для телевизора и просмотра издалека, меньше — если всё крупно.
              </div>
            </section>
          </>
        )}
        {tab === "sound" && (
          <>
            <section className="settings__item">
              <div className="settings__label">Вывод звука</div>
              <CycleRow
                label="Устройство"
                focusKey="settings:audiodevice:0"
                options={[{ value: "", label: "По умолчанию в Windows" }, ...devices.filter((d) => d.name !== "auto").map((d) => ({ value: d.name, label: d.description }))]}
                value={playerPrefs.audioDevice}
                onChange={(v) => setPlayerPrefs({ audioDevice: v })}
              />
              <div className="settings__hint">
                Куда играет звук фильмов, каналов и трейлеров в плеере; применяется со следующего запуска видео. Звуки меню и музыка идут на устройство Windows по умолчанию.
              </div>
            </section>
            <section className="settings__item">
              <div className="settings__label">Набор звуков</div>
              <SoundKitRow focusPrefix="settings:snd:kit" />
              <div className="settings__hint">Готовый набор сразу меняет кнопки и навигацию. Ниже можно подобрать отдельно.</div>
            </section>
            {SOUND_CATEGORIES.map((category) => (
              <section className="settings__item" key={category}>
                <div className="settings__label">
                  {SOUND_CATEGORY_LABELS[category]}
                </div>
                <SoundCategoryRow
                  category={category}
                  focusPrefix={`settings:snd:${category}`}
                />
                <div className="settings__hint">
                  Навелись — услышали. Enter — выбрать, «Без звука» — выключить
                  категорию.
                </div>
              </section>
            ))}
            <section className="settings__item">
              <div className="settings__label">Громкость звуков</div>
              <VolumeRow
                focusKey="settings:snd:volume"
                volume={sfxVolume}
                onChange={setSfxVolume}
              />
              <div className="settings__hint">
                Влево/вправо с пульта, клик или перетаскивание мышью — громкость всех
                звуковых эффектов.
              </div>
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
              <div className="settings__hint">
                {musicEnabled && currentTrack
                  ? `Сейчас играет: ${currentTrack.title} — ${currentTrack.artist}`
                  : "Тихая фоновая музыка во время просмотра каталога — не звучит поверх плеера. Набор звуков PS4 приносит свою музыку."}
              </div>
            </section>
            <section className="settings__item">
              <div className="settings__label">Громкость музыки</div>
              <VolumeRow
                focusKey="settings:music:volume"
                volume={musicVolume}
                onChange={setMusicVolume}
              />
              <div className="settings__hint">
                Влево/вправо с пульта, клик или перетаскивание мышью — громкость
                фоновой музыки.
              </div>
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
              <div className="settings__hint">
                {soundPinned
                  ? "Звуки, музыка и громкость закреплены — смена темы (в т.ч. PS4 и PS5) их не меняет."
                  : "Закрепляет текущие звуки, музыку и громкость: темы PS4/PS5 больше не подменят их своими."}
              </div>
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
              <div className="settings__hint">Друзья увидят «Смотрит KINONYX» и название. Нужен запущенный Discord.</div>
            </section>

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
              <div className="settings__hint">
                {dataNote || "Избранное, «продолжить», прогресс, статистика, плейлисты и настройки сами копируются в папку .kinonyx\\userdata и вернутся, если данные программы пропадут при обновлении или переустановке. Файл нужен, чтобы перенести данные на другой компьютер."}
              </div>
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

function Hint({ note, fallback }: { note: Note; fallback: string }) {
  if (!note) return <div className="settings__hint">{fallback}</div>;
  return (
    <div className={`settings__hint settings__hint--${note.kind}`}>
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
        <div className="settings__hint">
          Телефон и компьютер — в одной сети Wi-Fi. Наведите камеру на код, откроется страница с кнопками.
        </div>
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
          <div className="settings__hint">
            Код сохраняется: один раз отсканировали — и в следующие разы пульт откроется сам, когда KINONYX запущен. Откройте адрес в браузере телефона и
            добавьте его на главный экран («Поделиться» → «На экран Домой» в Safari, меню ⋮ → «Добавить на главный экран» в Chrome) — получится значок.
            Адрес с «.local» не меняется, даже если роутер выдал компьютеру новый номер.
          </div>
          <div className="settings__hint">После смены кода прежние телефоны перестанут работать — отсканируйте новый.</div>
        </section>
      )}
    </>
  );
}
