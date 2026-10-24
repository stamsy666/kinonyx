import { useEffect, useState } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { BackIcon, Focusable, FocusGroup, NextIcon } from "@kinonyx/ui";
import { useApp } from "../store/app";
import {
  checkSourceKey,
  setKinopoiskApiKey,
  setMetadataSource,
  setSetupDone,
  setTmdbApiKey,
  type MetadataSource,
} from "../data/api";
import { openExternal } from "../data/io";
import { rematchAll } from "../data/rematch";
import logoMark from "../assets/logo-mark.png";
import { TextField } from "../components/TextField";

const SOURCES: {
  key: MetadataSource;
  label: string;
  blurb: string;
  keyUrl: string;
  keyHost: string;
}[] = [
  {
    key: "kinopoisk",
    label: "Кинопоиск",
    blurb: "Русские названия, кадры, похожие фильмы. Бесплатный ключ даёт 500 запросов в сутки.",
    keyUrl: "https://kinopoiskapiunofficial.tech/profile",
    keyHost: "kinopoiskapiunofficial.tech",
  },
  {
    key: "tmdb",
    label: "TMDB",
    blurb: "Не ограничивает по запросам, но у части провайдеров заблокирован — понадобится VPN.",
    keyUrl: "https://www.themoviedb.org/settings/api",
    keyHost: "themoviedb.org/settings/api",
  },
];

type Note = { kind: "ok" | "error"; text: string } | null;

/** First-run wizard: pick a source → paste & verify its key → movies load. The key is only
 *  saved once the server accepted it, so a typo never leaves a half-working app behind. */
export function SetupScreen() {
  const navigate = useApp((s) => s.navigate);
  const [step, setStep] = useState<0 | 1>(0);
  const [source, setSource] = useState<MetadataSource>("kinopoisk");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  // The "Далее" button that held focus unmounts with step 0, so hand focus to the field.
  useEffect(() => {
    if (step === 1) requestAnimationFrame(() => setFocus("setup:key"));
  }, [step]);
  const meta = SOURCES.find((s) => s.key === source)!;

  const finish = async () => {
    await setMetadataSource(source);
    useApp.getState().setMetadataSourceState(source);
    void rematchAll(source);
    await setSetupDone(true);
    navigate({ name: "home" });
  };

  const verify = async () => {
    const value = key.trim();
    if (!value || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await checkSourceKey(source, value);
      if (source === "kinopoisk") await setKinopoiskApiKey(value);
      else await setTmdbApiKey(value);
      setNote({ kind: "ok", text: "Ключ принят — загружаю фильмы…" });
      await finish();
    } catch (e) {
      setNote({ kind: "error", text: String(e) });
      setBusy(false);
    }
  };

  return (
    <FocusGroup focusKey="setup" className="settings screen-pad home home--tv home--nohero settings--tv">
      <div className="stx">
        <div className="stx__stage">
          <div className="stx__art">
            <img className="setup__logo" src={logoMark} alt="" />
          </div>
          <p className="stx__desc">
            {step === 0
              ? "Добро пожаловать в KINONYX. Откуда брать информацию о фильмах? Это можно поменять потом в Настройках."
              : `Вставьте API-ключ ${meta.label} — он нужен, чтобы загрузить каталог.`}
          </p>
        </div>

        <div className="stx__list">
          <div className="settings-pane" key={step}>
            {step === 0 && (
              <>
                <section className="settings__item">
                  <div className="settings__label">Источник</div>
                  <div className="sound-options">
                    {SOURCES.map((s, i) => (
                      <Focusable
                        as="button"
                        key={s.key}
                        focusKey={`setup:source:${i}`}
                        autoFocus={i === 0}
                        className={`sound-option ${source === s.key ? "is-active" : ""}`}
                        onPress={() => setSource(s.key)}
                      >
                        {s.label}
                      </Focusable>
                    ))}
                  </div>
                  <div className="settings__hint">{meta.blurb}</div>
                </section>
                <section className="settings__item">
                  <Focusable as="button" className="cycle-row" focusKey="setup:next" onPress={() => setStep(1)}>
                    <span className="cycle-row__label">Далее</span>
                    <NextIcon size={20} />
                  </Focusable>
                </section>
              </>
            )}

            {step === 1 && (
              <>
                <Focusable as="button" back focusKey="setup:back" className="stx__row stx__back" onPress={() => setStep(0)}>
                  <span className="stx__row-icon">
                    <BackIcon size={22} />
                  </span>
                  <span className="stx__row-label">Назад</span>
                </Focusable>
                <section className="settings__item">
                  <div className="settings__label">API-KEY {meta.label.toUpperCase()}</div>
                  <TextField
                    focusKey="setup:key"
                    autoFocus
                    value={key}
                    onChange={(v) => {
                      setKey(v);
                      setNote(null);
                    }}
                    onSubmit={() => void verify()}
                    placeholder={`Вставьте ключ с ${meta.keyHost}`}
                  />
                  <div className={`settings__hint ${note ? `settings__hint--${note.kind}` : ""}`}>
                    {note?.text ?? "Enter — проверить. Ключ хранится только на этом компьютере."}
                  </div>
                </section>
                <section className="settings__item">
                  <Focusable as="button" className="cycle-row" focusKey="setup:verify" onPress={() => void verify()}>
                    <span className="cycle-row__label">{busy ? "Проверяю…" : "Проверить и продолжить"}</span>
                    <NextIcon size={20} />
                  </Focusable>
                  <Focusable as="button" className="cycle-row" focusKey="setup:get-key" onPress={() => void openExternal(meta.keyUrl)}>
                    <span className="cycle-row__label">Где взять ключ</span>
                    <span className="cycle-row__value">{meta.keyHost}</span>
                    <NextIcon size={20} />
                  </Focusable>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </FocusGroup>
  );
}
