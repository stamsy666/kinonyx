import { useEffect, useState } from "react";
import { Focusable, TrashIcon } from "@kinonyx/ui";
import { useTranslator } from "../store/translator";
import {
  DELAY_OPTIONS,
  formatSize,
  SOURCE_LANGS,
  type TranslatorItem,
} from "../data/translator";
import { isTauri } from "../data/io";
import { Switch } from "./Switch";
import { FocusHighlight } from "./FocusHighlight";

/** Settings → «Локальный перевод»: install/select the models, broadcast delay, language. */
export function TranslatorSettings() {
  const t = useTranslator();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void t.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isTauri) {
    return (
      <section className="settings__item">
        <div className="settings__label">Локальный перевод</div>
        <div className="settings__hint">
          Доступен только в приложении для ПК.
        </div>
      </section>
    );
  }

  const byKind = (k: TranslatorItem["kind"]) =>
    t.items.filter((i) => i.kind === k);
  const engine = byKind("engine")[0];

  const row = (
    item: TranslatorItem,
    selected?: boolean,
    onSelect?: () => void,
  ) => {
    const p = t.progress[item.id];
    const downloading = item.downloading || (p != null && !p.error);
    return (
      <div className="tr-item" key={item.id}>
        <Focusable
          as="button"
          focusKey={`settings:tr:${item.id}`}
          className={`tr-item__main ${selected ? "is-active" : ""} ${onSelect ? "" : "tr-item__main--static"}`}
          onPress={() => onSelect?.()}
        >
          {onSelect && (
            <span className={`tr-item__radio ${selected ? "is-on" : ""}`} />
          )}
          <span className="tr-item__text">
            <span className="tr-item__title">{item.title}</span>
            <span className="tr-item__note">{item.note}</span>
            {p?.error && <span className="tr-item__error">{p.error}</span>}
          </span>
        </Focusable>
        <div className="tr-item__side">
          {item.installed ? (
            <>
              <span className="tr-item__badge">Установлено</span>
              <Focusable
                as="button"
                className="icon-btn"
                focusKey={`settings:tr:${item.id}:del`}
                onPress={async () => setError(await t.remove(item.id))}
                scroll={false}
              >
                <TrashIcon size={18} />
              </Focusable>
            </>
          ) : downloading ? (
            <>
              <span className="tr-item__progress">
                <i
                  style={{
                    width: `${p && p.total ? Math.min(100, (p.received / p.total) * 100) : 0}%`,
                  }}
                />
                <b>
                  {p?.stage
                    ? `${p.stage} ${p.total ? Math.floor((p.received / p.total) * 100) + "%" : ""}`
                    : p && p.total
                      ? `${formatSize(p.received)} из ${formatSize(p.total)}`
                      : "Загрузка…"}
                </b>
              </span>
              <Focusable
                as="button"
                className="btn btn--ghost"
                focusKey={`settings:tr:${item.id}:cancel`}
                onPress={() => void t.cancel(item.id)}
              >
                Отмена
              </Focusable>
            </>
          ) : (
            <Focusable
              as="button"
              className="btn"
              focusKey={`settings:tr:${item.id}:get`}
              onPress={() =>
                void t.download(item.id).catch((e) => setError(String(e)))
              }
            >
              Скачать · {formatSize(item.size)}
            </Focusable>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <section className="settings__item">
        <div className="settings__label">Локальный перевод</div>
        <div className="settings__hint">
          Перевод речи иностранных каналов на русский прямо на этом компьютере —
          без интернета и сервисов. Включается в плеере каналов: «Субтитры» →
          «Локальный перевод». Нужна видеокарта NVIDIA (RTX 20xx и новее).
        </div>
        {!t.bundled && (
          <div className="settings__hint settings__hint--error">
            В этой сборке нет whisper-server.exe — переустановите программу.
          </div>
        )}
        {error && (
          <div className="settings__hint settings__hint--error">{error}</div>
        )}
        <div className="tr-list">
          <FocusHighlight pad={5} radius={16} />
          {engine && row(engine)}
        </div>
      </section>

      <section className="settings__item">
        <div className="settings__label">
          Распознавание речи
          <Switch focusKey="settings:tr:asr:on" on={t.asrEnabled} onChange={t.setAsrEnabled} />
        </div>
        {!t.asrEnabled && (
          <div className="settings__hint">
            Выключено — перевод и закадровый голос в плеере недоступны, модели
            остаются на диске.
          </div>
        )}
        <div className={`tr-list ${t.asrEnabled ? "" : "tr-list--off"}`}>
          <FocusHighlight pad={5} radius={16} />
          {byKind("asr").map((i) =>
            row(i, t.asrModel === i.id, () => t.setAsrModel(i.id)),
          )}
        </div>
      </section>

      <section className="settings__item">
        <div className="settings__label">
          Модель перевода
          <Switch focusKey="settings:tr:mt:on" on={t.mtEnabled} onChange={t.setMtEnabled} />
        </div>
        {!t.mtEnabled && (
          <div className="settings__hint">
            Выключено — перевод и закадровый голос в плеере недоступны, модели
            остаются на диске.
          </div>
        )}
        <div className={`tr-list ${t.mtEnabled ? "" : "tr-list--off"}`}>
          <FocusHighlight pad={5} radius={16} />
          {byKind("mt").map((i) =>
            row(i, t.mtModel === i.id, () => t.setMtModel(i.id)),
          )}
        </div>
        <div className="settings__hint">
          Модели хранятся в {t.root || "%USERPROFILE%\\.kinonyx\\translator"}.
        </div>
      </section>

      <section className="settings__item">
        <div className="settings__label">
          Закадровый голос
          <Switch focusKey="settings:tr:voice:on" on={t.voiceEnabled} onChange={t.setVoiceEnabled} />
        </div>
        <div className="settings__hint">
          Перевод звучит голосом того, кто говорит, поверх приглушённого
          оригинала. Включается в плеере: «Субтитры» → «Закадровый голос» —
          отдельно от субтитров. Нужны и распознавание, и перевод выше.
          {!t.voiceEnabled && " Сейчас выключен — в плеере его не будет."}
        </div>
        {t.vramMb != null && t.vramMb < 10000 && (
          <div className="settings__hint">
            На видеокарте {Math.round(t.vramMb / 1024)} ГБ памяти впритык для
            трёх моделей сразу — для голоса выберите сжатые модели распознавания
            и перевода.
          </div>
        )}
        <div className={`tr-list ${t.voiceEnabled ? "" : "tr-list--off"}`}>
          <FocusHighlight pad={5} radius={16} />
          {byKind("voice").map((i) => row(i))}
        </div>
      </section>

      <section className="settings__item">
        <div className="settings__label">Задержка эфира при переводе</div>
        <div className="sound-options">
          <FocusHighlight pad={6} radius={16} />
          {DELAY_OPTIONS.map((s) => (
            <Focusable
              as="button"
              key={s}
              focusKey={`settings:tr:delay:${s}`}
              className={`sound-option ${t.delay === s ? "is-active" : ""}`}
              onPress={() => t.setDelay(s)}
            >
              {s} с
            </Focusable>
          ))}
        </div>
        <div className="settings__hint">
          Эфир идёт с отставанием, а переводчик слушает его заранее — поэтому
          субтитр появляется ровно в момент фразы и целиком. Чем больше
          задержка, тем точнее и полнее перевод длинных фраз; 20 с — хороший
          баланс.
        </div>
      </section>

      <section className="settings__item">
        <div className="settings__label">Язык эфира</div>
        <div className="sound-options">
          <FocusHighlight pad={6} radius={16} />
          {SOURCE_LANGS.map((l) => (
            <Focusable
              as="button"
              key={l.code ?? "auto"}
              focusKey={`settings:tr:lang:${l.code ?? "auto"}`}
              className={`sound-option ${t.sourceLang === l.code ? "is-active" : ""}`}
              onPress={() => t.setSourceLang(l.code)}
            >
              {l.label}
            </Focusable>
          ))}
        </div>
        <div className="settings__hint">
          Если язык известен, укажите его — так распознавание не спутает его с
          другим на шумных фрагментах.
        </div>
      </section>
    </>
  );
}
