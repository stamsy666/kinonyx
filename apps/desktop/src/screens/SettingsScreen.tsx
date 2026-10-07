import { useEffect, useState } from "react";
import { BackIcon, Focusable, FocusGroup } from "@kinonyx/ui";
import { useApp } from "../store/app";
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
import { BG_KINDS, BG_PALETTES } from "../data/backgrounds";
import { SOUND_CATEGORIES, SOUND_CATEGORY_LABELS } from "../data/sounds";
import { SoundCategoryRow } from "../components/SoundCategoryRow";
import { MUSIC_CREDITS } from "../data/music";
import { FullscreenButton } from "../components/FullscreenButton";
import { VolumeRow } from "../components/VolumeRow";
import { TranslatorSettings } from "../components/TranslatorSettings";
import { FocusHighlight } from "../components/FocusHighlight";
import type { EpgRefreshInterval } from "../store/app";
import { rematchAll } from "../data/rematch";
import { useUpdater } from "../store/updater";
import { isTauri } from "../data/io";

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

export function SettingsScreen() {
  const back = useApp((s) => s.back);
  const navigate = useApp((s) => s.navigate);
  const showStats = useApp((s) => s.showStreamStats);
  const setShowStats = useApp((s) => s.setShowStreamStats);
  const clickSparkEnabled = useApp((s) => s.clickSparkEnabled);
  const setClickSparkEnabled = useApp((s) => s.setClickSparkEnabled);
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
  const currentTrack = useApp((s) => s.currentTrack);
  const epgRefreshInterval = useApp((s) => s.epgRefreshInterval);
  const setEpgRefreshInterval = useApp((s) => s.setEpgRefreshInterval);

  const updStatus = useUpdater((s) => s.status);
  const updVersion = useUpdater((s) => s.update?.version);
  const updError = useUpdater((s) => s.error);
  const autoCheck = useUpdater((s) => s.autoCheck);
  const [appVersion, setAppVersion] = useState("1.0.6");
  useEffect(() => {
    if (!isTauri) return;
    void import("@tauri-apps/api/app").then((m) => m.getVersion()).then(setAppVersion, () => undefined);
  }, []);

  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [torapi, setTorapi] = useState("");
  const [key, setKey] = useState("");
  const [tmdbKey, setTmdbKey] = useState("");
  const [torapiNote, setTorapiNote] = useState<Note>(null);
  const [keyNote, setKeyNote] = useState<Note>(null);
  const [tmdbKeyNote, setTmdbKeyNote] = useState<Note>(null);
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
    <FocusGroup focusKey="settings" className="settings screen-pad">
      <header className="settings__head">
        <Focusable
          as="button"
          className="back-btn"
          focusKey="settings:back"
          onPress={() => back() || navigate({ name: "home" })}
          scrollBlock="start"
        >
          <BackIcon size={18} />
          Назад
        </Focusable>
        <h1 className="settings__title">Настройки</h1>
        <FullscreenButton focusKey="settings:fullscreen" />
      </header>

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
          autoFocus
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
      </section>

      <section className="settings__item">
        <div className="settings__label">Источник метаданных</div>
        <div className="sound-options">
          <FocusHighlight pad={6} radius={16} />
          {SOURCE_OPTIONS.map((opt, i) => (
            <Focusable
              as="button"
              key={opt.key}
              focusKey={`settings:source:${i}`}
              className={`sound-option ${status?.metadata_source === opt.key ? "is-active" : ""}`}
              onPress={() => void switchSource(opt.key)}
            >
              {opt.label}
            </Focusable>
          ))}
        </div>
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
      </section>

      <section className="settings__item">
        <div className="settings__label">Cookies YouTube для трейлеров</div>
        <div className="sound-options">
          <FocusHighlight pad={6} radius={16} />
          {COOKIES_OPTIONS.map((opt, i) => (
            <Focusable
              as="button"
              key={opt.key || "off"}
              focusKey={`settings:cookies:${i}`}
              className={`sound-option ${(status?.youtube_cookies_browser ?? "") === opt.key ? "is-active" : ""}`}
              onPress={() => void switchCookies(opt.key)}
            >
              {opt.label}
            </Focusable>
          ))}
        </div>
        <div className="settings__hint">
          Если YouTube отвечает «подтвердите, что вы не бот», трейлеры можно открыть
          через вашу сессию YouTube в выбранном браузере — нужно быть в нём
          залогиненным. Приложение читает только cookies YouTube, только при
          открытии трейлера и только на этом компьютере. Браузер при этом должен
          быть полностью закрыт.
        </div>
      </section>

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
        <div className="sound-options">
          <FocusHighlight pad={6} radius={16} />
          {UI_SCALE_OPTIONS.map((o, i) => (
            <Focusable
              as="button"
              key={o.value}
              focusKey={`settings:uiscale:${i}`}
              className={`sound-option ${playerPrefs.uiScale === o.value ? "is-active" : ""}`}
              onPress={() => setPlayerPrefs({ uiScale: o.value })}
            >
              {o.label}
            </Focusable>
          ))}
        </div>
        <div className="settings__hint">Размер кнопок, названия и времени на экране плеера — для большого экрана или пульта издалека.</div>
      </section>

      <section className="settings__item">
        <div className="settings__label">Скрывать кнопки плеера через</div>
        <div className="sound-options">
          <FocusHighlight pad={6} radius={16} />
          {AUTO_HIDE_OPTIONS.map((o, i) => (
            <Focusable
              as="button"
              key={o.value}
              focusKey={`settings:autohide:${i}`}
              className={`sound-option ${playerPrefs.autoHideSec === o.value ? "is-active" : ""}`}
              onPress={() => setPlayerPrefs({ autoHideSec: o.value })}
            >
              {o.label}
            </Focusable>
          ))}
        </div>
        <div className="settings__hint">Сколько секунд без нажатий кнопки остаются на экране.</div>
      </section>

      <section className="settings__item">
        <div className="settings__label">Субтитры</div>
        <div className="sound-options">
          <FocusHighlight pad={6} radius={16} />
          {SUBTITLE_SIZE_OPTIONS.map((o, i) => (
            <Focusable
              as="button"
              key={o.value}
              focusKey={`settings:subsize:${i}`}
              className={`sound-option ${playerPrefs.subtitleScale === o.value ? "is-active" : ""}`}
              onPress={() => setPlayerPrefs({ subtitleScale: o.value })}
            >
              {o.label}
            </Focusable>
          ))}
        </div>
        <div className="sound-options" style={{ marginTop: 10 }}>
          <FocusHighlight pad={6} radius={16} />
          {SUBTITLE_COLOR_OPTIONS.map((o, i) => (
            <Focusable
              as="button"
              key={o.value}
              focusKey={`settings:subcolor:${i}`}
              className={`sound-option ${playerPrefs.subtitleColor === o.value ? "is-active" : ""}`}
              onPress={() => setPlayerPrefs({ subtitleColor: o.value })}
            >
              <span className="swatch" style={{ background: o.value }} />
              {o.label}
            </Focusable>
          ))}
        </div>
        <div className="settings__hint">Размер и цвет текста субтитров применяются со следующего запуска видео.</div>
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

      <section className="settings__item">
        <div className="settings__label">Эффект клика мышью</div>
        <Focusable
          as="button"
          className={`checkbox ${clickSparkEnabled ? "is-on" : ""}`}
          focusKey="settings:clickSpark"
          onPress={() => setClickSparkEnabled(!clickSparkEnabled)}
        >
          <span className="checkbox__box">
            {clickSparkEnabled && (
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
          Искры от курсора на каждый клик мышью — только для мыши, пульт и
          геймпад не затронуты.
        </div>
      </section>

      <section className="settings__item">
        <div className="settings__label">Обновление программы передач</div>
        <div className="sound-options">
          <FocusHighlight pad={6} radius={16} />
          {EPG_REFRESH_OPTIONS.map((opt, i) => (
            <Focusable
              as="button"
              key={opt.key}
              focusKey={`settings:epg:${i}`}
              className={`sound-option ${epgRefreshInterval === opt.key ? "is-active" : ""}`}
              onPress={() => setEpgRefreshInterval(opt.key)}
            >
              {opt.label}
            </Focusable>
          ))}
        </div>
        <div className="settings__hint">
          Уже загруженная программа передач остаётся в памяти, пока не истечёт
          выбранный срок — заходить в «Каналы» заново не значит ждать загрузку
          снова.
        </div>
      </section>

      <TranslatorSettings />

      <section className="settings__item">
        <div className="settings__label">Темы</div>
        <div className="bg-options">
          <FocusHighlight pad={8} radius={20} />
          {BG_KINDS.map((kind, i) => {
            const palette = BG_PALETTES[kind];
            return (
              <Focusable
                as="button"
                key={kind}
                focusKey={`settings:bg:${i}`}
                className={`bg-option ${backgroundKind === kind ? "is-active" : ""}`}
                onPress={() => setBackgroundKind(kind)}
              >
                <span
                  className="bg-option__swatch"
                  style={{
                    background: `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accentDeep} 100%)`,
                  }}
                />
                {palette.label}
              </Focusable>
            );
          })}
        </div>
        <div className="settings__hint">
          Анимация и акцентный цвет интерфейса меняются вместе.
        </div>
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
            : "Тихая фоновая музыка во время просмотра каталога — не звучит поверх плеера."}
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
        <div className="settings__label">Обновления</div>
        <div className="sound-options">
          <FocusHighlight pad={6} radius={16} />
          <Focusable
            as="button"
            focusKey="settings:update-check"
            className="sound-option"
            onPress={() => {
              const u = useUpdater.getState();
              if (u.status === "available") useUpdater.setState({ dismissed: false });
              else void u.check(true);
            }}
          >
            {updStatus === "checking" ? "Проверяю…" : updStatus === "available" ? `Установить ${updVersion}` : "Проверить обновления"}
          </Focusable>
          <Focusable
            as="button"
            focusKey="settings:update-auto"
            className={`sound-option ${autoCheck ? "is-active" : ""}`}
            onPress={() => useUpdater.getState().setAutoCheck(!autoCheck)}
          >
            Автопроверка: {autoCheck ? "вкл" : "выкл"}
          </Focusable>
        </div>
        <div className={`settings__hint ${updStatus === "error" ? "settings__hint--error" : updStatus === "uptodate" ? "settings__hint--ok" : ""}`}>
          {updStatus === "uptodate" && `У вас последняя версия (${appVersion}).`}
          {updStatus === "available" && `Доступна версия ${updVersion}.`}
          {updStatus === "error" && updError}
          {(updStatus === "idle" || updStatus === "checking") && `Сейчас установлена версия ${appVersion}. Проверка — раз в сутки при запуске.`}
        </div>
      </section>

      <footer className="settings__footer">
        <Focusable
          as="button"
          className="credit"
          focusKey="settings:credit"
          onPress={() => setCreditOpen(true)}
        >
          Разработчик — <b>kidencedev</b>
        </Focusable>
        <Focusable
          as="button"
          className="credit"
          focusKey="settings:music-credit"
          onPress={() => setMusicCreditOpen(true)}
        >
          Музыка — <b>NCMFYT, C152, Affection Core</b>
        </Focusable>
        <Focusable
          as="button"
          className="credit"
          focusKey="settings:diagnostics"
          onPress={() => navigate({ name: "diagnostics" })}
        >
          <b>Диагностика</b>
        </Focusable>
        <Focusable
          as="button"
          className="credit"
          focusKey="settings:rerun-setup"
          onPress={() => navigate({ name: "setup" })}
        >
          Пройти настройку заново
        </Focusable>
        <span className="settings__version">KINONYX {appVersion}</span>
      </footer>

      {creditOpen && (
        <LinksModal
          heading="kidencedev"
          empty=""
          links={DEV_LINKS}
          onClose={() => setCreditOpen(false)}
        />
      )}
      {musicCreditOpen && (
        <LinksModal
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
