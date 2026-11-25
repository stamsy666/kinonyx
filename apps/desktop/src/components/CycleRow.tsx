import { useCallback, useRef, useState } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { cancelGlides, Focusable, NextIcon } from "@kinonyx/ui";
import { RESTORE_DETAILS } from "../data/focusRestore";
import { Modal } from "./Modal";

/** A settings row that opens the available values and applies the one the viewer selects. */
export function CycleRow<T>({
  label,
  heading = label,
  focusKey,
  options,
  value,
  onChange,
  swatch,
}: {
  label: string;
  heading?: string;
  focusKey: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void | Promise<void>;
  /** A colour dot before the value (the subtitle colours). */
  swatch?: (value: T) => string;
}) {
  const index = options.findIndex((option) => option.value === value);
  const current = options[index];
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  const close = useCallback(() => {
    if (pending.current) return;
    cancelGlides();
    setFocus(focusKey, { ...RESTORE_DETAILS, skipScroll: true });
    setOpen(false);
  }, [focusKey]);

  const select = async (next: T) => {
    if (pending.current) return;
    if (next === value) {
      close();
      return;
    }
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      await onChange(next);
    } catch (cause) {
      setError(`Не удалось сохранить настройку. ${cause instanceof Error ? cause.message : String(cause)}`);
      return;
    } finally {
      pending.current = false;
      setSaving(false);
    }
    close();
  };

  return (
    <>
      <Focusable
        as="button"
        focusKey={focusKey}
        className="cycle-row"
        onPress={() => {
          if (!options.length) return;
          cancelGlides();
          setError("");
          setOpen(true);
        }}
      >
        <span className="cycle-row__label">{label}</span>
        <span className="cycle-row__value">
          {swatch && current && <i className="cycle-row__swatch" style={{ background: swatch(current.value) }} />}
          {current?.label}
        </span>
        <NextIcon size={20} />
      </Focusable>
      {open && (
        <Modal focusKey={`${focusKey}:picker`} className="links-tv" onClose={close}>
          <h3 className="links-tv__title">{heading}</h3>
          <div className="links-tv__list links-tv__scroll">
            {options.map((option, i) => (
              <Focusable
                as="button"
                key={i}
                focusKey={`${focusKey}:option:${i}`}
                autoFocus={i === Math.max(0, index)}
                scrollBlock="nearest"
                className={`links-tv__row${i === index ? " is-active" : ""}`}
                aria-label={i === index ? `${option.label}, выбрано` : option.label}
                onPress={() => void select(option.value)}
              >
                {swatch && <i className="cycle-row__swatch" style={{ background: swatch(option.value) }} />}
                <span className="links-tv__name">{option.label}</span>
                {i === index && <span aria-hidden="true" className="links-tv__check">✓</span>}
              </Focusable>
            ))}
          </div>
          {error && <p className="settings__hint--error" role="alert">{error}</p>}
          <Focusable as="button" back focusKey={`${focusKey}:close`} className="links-tv__row links-tv__row--close links-tv__foot" scroll={false} onPress={close}>
            {saving ? "Сохранение…" : "Закрыть"}
          </Focusable>
        </Modal>
      )}
    </>
  );
}
