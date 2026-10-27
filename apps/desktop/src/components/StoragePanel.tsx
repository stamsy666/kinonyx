import { useCallback, useEffect, useState } from "react";
import { Focusable, Spinner } from "@kinonyx/ui";
import { isTauri } from "../data/io";

interface StorageItem {
  key: string;
  label: string;
  hint: string;
  bytes: number;
  clearable: boolean;
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} ГБ`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} МБ`;
  if (n >= 1024) return `${Math.round(n / 1024)} КБ`;
  return n > 0 ? `${n} Б` : "пусто";
}

/** Settings → Хранилище: what the program keeps on the disk, and a button to clear what can be cleared. */
export function StoragePanel() {
  const [items, setItems] = useState<StorageItem[] | null>(null);
  const [armed, setArmed] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!isTauri) {
      setItems([]);
      return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    setItems(await invoke<StorageItem[]>("storage_usage"));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const press = async (item: StorageItem) => {
    if (!item.clearable) {
      setNote(item.hint);
      return;
    }
    // Clearing asks twice: the first press arms the row.
    if (armed !== item.key) {
      setArmed(item.key);
      setNote(`«${item.label}»: ${item.hint} Нажмите ещё раз, чтобы очистить.`);
      return;
    }
    setArmed("");
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const freed = await invoke<number>("storage_clear", { key: item.key });
      setNote(freed > 0 ? `Освобождено ${formatBytes(freed)}.` : "Здесь уже было пусто.");
    } catch (e) {
      setNote(`Не удалось очистить: ${e instanceof Error ? e.message : String(e)}`);
    }
    await load();
  };

  const total = (items ?? []).reduce((sum, i) => sum + i.bytes, 0);
  const clearable = (items ?? []).filter((i) => i.clearable).reduce((sum, i) => sum + i.bytes, 0);

  if (!items) {
    return (
      <div className="stx-wait">
        <Spinner />
      </div>
    );
  }
  return (
    <>
      <section className="settings__item">
        <div className="settings__label">Занято на диске</div>
        <div className="storage-total">
          <b>{formatBytes(total)}</b>
          <span>из них можно очистить {formatBytes(clearable)}</span>
        </div>
      </section>
      <section className="settings__item">
        <div className="settings__label">Что хранится</div>
        {items.map((item, i) => (
          <Focusable
            as="button"
            key={item.key}
            className={`cycle-row ${armed === item.key ? "cycle-row--armed" : ""}`}
            focusKey={`settings:storage:${i}`}
            onPress={() => void press(item)}
            autoFocus={false}
          >
            <span className="cycle-row__label">{item.label}</span>
            <span className="cycle-row__value">{armed === item.key ? "Нажмите ещё раз" : item.clearable ? `${formatBytes(item.bytes)} · очистить` : formatBytes(item.bytes)}</span>
          </Focusable>
        ))}
        <div className="settings__hint">{note || "Кэши (картинки, ответы источников, программа передач, журналы) можно очищать: они скачаются заново. Остальное программа не трогает."}</div>
      </section>
    </>
  );
}
