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
import { CycleRow } from "./CycleRow";
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
    const status = item.installed
      ? onSelect
        ? selected
          ? "Выбрано"
          : "Установлено"
        : "Установлено"
      : downloading
        ? p?.stage
          ? `${p.stage} ${p.total ? Math.floor((p.received / p.total) * 100) + "%" : ""}`
          : p && p.total
            ? `${Math.floor((p.received / p.total) * 100)}%`
            : "Загрузка…"
        : `Скачать · ${formatSize(item.size)}`;
    return (
      <div className="tr-item" key={item.id}>
        <Focusable
          as="button"
          focusKey={`settings:tr:${item.id}`}
          className={`tr-item__main ${selected ? "is-active" : ""}`}
          onPress={() => {
            if (item.installed) onSelect?.();
            else if (!downloading) void t.download(item.id).catch((e) => setError(String(e)));
          }}
        >
          <span className="tr-item__text">
            <span className="tr-item__title">{item.title}</span>
            <span className="tr-item__note">{p?.error ?? item.note}</span>
          </span>
          <span className="tr-item__state">{status}</span>
        </Focusable>
        {(item.installed || downloading) && (
          <Focusable
            as="button"
            className="icon-btn tr-item__action"
            focusKey={`settings:tr:${item.id}:act`}
            onPress={async () => (item.installed ? setError(await t.remove(item.id)) : void t.cancel(item.id))}
            scroll={false}
          >
            {item.installed ? <TrashIcon size={18} /> : "×"}
          </Focusable>
        )}
      </div>
    );
  };

  return (
    <>
      <section className="settings__item">
        <div className="settings__label">Локальный перевод</div>
        <div className="settings__hint">
          Перевод речи каналов на русский прямо на этом компьютере. Включается в плеере: «Субтитры» → «Локальный перевод». Нужна видеокарта NVIDIA.
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
        <div className="settings__label">Распознавание речи</div>
        <Switch focusKey="settings:tr:asr:on" on={t.asrEnabled} onChange={t.setAsrEnabled} />
        {!t.asrEnabled && (
          <div className="settings__hint">
            Выключено — в плеере недоступно, модели остаются на диске.
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
        <div className="settings__label">Модель перевода</div>
        <Switch focusKey="settings:tr:mt:on" on={t.mtEnabled} onChange={t.setMtEnabled} />
        {!t.mtEnabled && (
          <div className="settings__hint">
            Выключено — в плеере недоступно, модели остаются на диске.
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
        <div className="settings__label">Закадровый голос</div>
        <Switch focusKey="settings:tr:voice:on" on={t.voiceEnabled} onChange={t.setVoiceEnabled} />
        <div className="settings__hint">
          Перевод звучит голосом поверх приглушённого оригинала. Включается в плеере. Нужны распознавание и перевод.
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
        <CycleRow
          label="Задержка"
          focusKey="settings:tr:delay"
          options={DELAY_OPTIONS.map((d) => ({ value: d, label: `${d} с` }))}
          value={t.delay}
          onChange={(v) => t.setDelay(v)}
        />
        <div className="settings__hint">
          Чем больше задержка, тем точнее перевод длинных фраз. 20 с — хороший баланс.
        </div>
      </section>

      <section className="settings__item">
        <div className="settings__label">Язык эфира</div>
        <CycleRow
          label="Язык"
          focusKey="settings:tr:lang"
          options={SOURCE_LANGS.map((l) => ({ value: l.code, label: l.label }))}
          value={t.sourceLang}
          onChange={(v) => t.setSourceLang(v)}
        />
        <div className="settings__hint">
          Если язык эфира известен, укажите его — так точнее.
        </div>
      </section>
    </>
  );
}
