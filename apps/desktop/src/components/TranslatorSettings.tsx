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
        <div className="settings__hint" role="status">
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
            {p?.error && <span className="tr-item__note" role="status">{p.error}</span>}
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
        <div className={`tr-list ${t.mtEnabled ? "" : "tr-list--off"}`}>
          <FocusHighlight pad={5} radius={16} />
          {byKind("mt").map((i) =>
            row(i, t.mtModel === i.id, () => t.setMtModel(i.id)),
          )}
        </div>
      </section>

      <section className="settings__item">
        <div className="settings__label">Закадровый голос</div>
        <Switch focusKey="settings:tr:voice:on" on={t.voiceEnabled} onChange={t.setVoiceEnabled} />
        {!t.voiceBundled && (
          <div className="settings__hint settings__hint--error">
            В этой сборке нет движка озвучки (omnivoice/tts-server.exe) — озвучка недоступна.
          </div>
        )}
        {t.voiceEnabled && t.mtEnabled && t.mtModel.startsWith("hymt2-7b-") && t.vramMb != null && t.vramMb < 10000 && (
          <div className="settings__hint settings__hint--error" role="status">
            Hy-MT2 7B и озвучке вместе не хватает видеопамяти. Выберите Hy-MT2 1.8B.
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
      </section>
    </>
  );
}
