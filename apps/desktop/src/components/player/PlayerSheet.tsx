import type { ReactNode } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { Focusable } from "@kinonyx/ui";
import { Modal } from "../Modal";
import { KxCheck } from "./PlayerIcons";

/**
 * The player's windows («Кромка»): a panel 600 px wide at the right edge, so the picture in the middle stays in
 * sight. A head (icon, title, a count), optional tabs, a list that scrolls after the focus, and «Закрыть» at the
 * foot that never scrolls away. No small print under it — the controls explain themselves.
 */
export function KxSheet({
  focusKey,
  preferredChildFocusKey,
  title,
  icon,
  count,
  tabs,
  top,
  fit,
  onClose,
  onBodyScroll,
  footer,
  children,
}: {
  focusKey: string;
  preferredChildFocusKey?: string;
  title: string;
  icon: ReactNode;
  count?: string;
  tabs?: ReactNode;
  /** Above the list, not scrolled with it (what the picture is, for «Картинка»). */
  top?: ReactNode;
  /** As tall as its content, centred vertically at the right edge. */
  fit?: boolean;
  onClose: () => void;
  onBodyScroll?: (el: HTMLDivElement) => void;
  /** Buttons of the foot; «Закрыть» when left out. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Modal focusKey={focusKey} preferredChildFocusKey={preferredChildFocusKey} variant="sheet" className={`kx-sheet ${fit ? "kx-sheet--fit" : ""}`} onClose={onClose}>
      <div className="kx-sheet__head">
        <span className="kx-sheet__icon">{icon}</span>
        <h3 className="kx-sheet__title">{title}</h3>
        {count && <span className="kx-sheet__count">{count}</span>}
      </div>
      {tabs}
      {top}
      <div className="kx-sheet__body" onScroll={onBodyScroll ? (e) => onBodyScroll(e.currentTarget) : undefined}>
        {children}
      </div>
      <div className="kx-sheet__foot">
        {footer ?? (
          <KxSheetButton focusKey={`${focusKey}:close`} back onPress={onClose}>
            Закрыть
          </KxSheetButton>
        )}
      </div>
    </Modal>
  );
}

/** A button of the sheet's foot (Закрыть, Сбросить). */
export function KxSheetButton({ focusKey, onPress, back, children }: { focusKey: string; onPress: () => void; back?: boolean; children: ReactNode }) {
  return (
    <Focusable as="button" className="kx-sheet-btn" focusKey={focusKey} onPress={onPress} back={back} scroll={false}>
      {children}
    </Focusable>
  );
}

export interface KxTab {
  key: string;
  label: string;
}

/**
 * Tabs over the list (Аудио · Субтитры · Картинка). The remote switches a tab the moment the focus lands on it;
 * the mouse switches on a click (a cursor passing over the tabs does not flick the list about).
 */
export function KxTabs({ tabs, current, onSelect, prefix }: { tabs: KxTab[]; current: string; onSelect: (key: string) => void; prefix: string }) {
  if (tabs.length < 2) return null;
  return (
    <div className="kx-tabs" role="tablist">
      {tabs.map((t) => (
        <Focusable
          key={t.key}
          as="button"
          className={`kx-tab ${t.key === current ? "is-current" : ""}`}
          focusKey={`${prefix}:${t.key}`}
          scroll={false}
          onPress={() => onSelect(t.key)}
          onFocus={(_layout, _props, details) => {
            if (!(details as { byMouse?: boolean } | undefined)?.byMouse && t.key !== current) onSelect(t.key);
          }}
        >
          {t.label}
        </Focusable>
      ))}
    </div>
  );
}

/**
 * One row of a list (a track, a quality, an episode). The focus of the remote is a white row; the one chosen is
 * marked by a red bar at the left, bold words and a tick — the two are independent and can be on the same row.
 */
export function KxRow({
  focusKey,
  label,
  hint,
  selected,
  onPress,
  autoFocus,
  toClose,
  onFocus,
}: {
  focusKey: string;
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  autoFocus?: boolean;
  /** A long list: → jumps to «Закрыть» instead of walking down through every row. */
  toClose?: string;
  onFocus?: () => void;
}) {
  return (
    <Focusable
      as="button"
      className={`kx-row ${selected ? "is-selected" : ""}`}
      focusKey={focusKey}
      onPress={onPress}
      autoFocus={autoFocus}
      scrollBlock="nearest"
      onFocus={onFocus ? () => onFocus() : undefined}
      onArrowPress={(direction) => {
        if (!toClose || direction !== "right") return true;
        void setFocus(toClose);
        return false;
      }}
    >
      <span className="kx-row__label">{label}</span>
      {hint && hint.trim().toLowerCase() !== label.trim().toLowerCase() && <span className="kx-row__hint">{hint}</span>}
      {selected && <KxCheck className="kx-row__check" size={28} />}
    </Focusable>
  );
}

/** A two-line row: the time over the name (a programme of the archive). */
export function KxStackRow({
  focusKey,
  time,
  title,
  selected,
  onPress,
  onFocus,
  autoFocus,
  toClose,
}: {
  focusKey: string;
  time: string;
  title: string;
  selected: boolean;
  onPress: () => void;
  onFocus?: () => void;
  autoFocus?: boolean;
  toClose?: string;
}) {
  return (
    <Focusable
      as="button"
      className={`kx-row kx-row--stack ${selected ? "is-selected" : ""}`}
      focusKey={focusKey}
      onPress={onPress}
      onFocus={onFocus ? () => onFocus() : undefined}
      autoFocus={autoFocus}
      scrollBlock="nearest"
      onArrowPress={(direction) => {
        if (!toClose || direction !== "right") return true;
        void setFocus(toClose);
        return false;
      }}
    >
      <span className="kx-row__stack">
        <span className="kx-row__time">{time}</span>
        <span className="kx-row__label">{title}</span>
      </span>
      {selected && <KxCheck className="kx-row__check" size={28} />}
    </Focusable>
  );
}

export interface KxOption<T> {
  value: T;
  label: string;
}

/**
 * A setting with a few values, all of them in sight. ← / → change the value at once (OK steps to the next one);
 * the mouse clicks the value it wants.
 */
export function KxSegmentRow<T extends string | number | boolean>({
  focusKey,
  label,
  note,
  options,
  value,
  onChange,
  autoFocus,
}: {
  focusKey: string;
  label: string;
  note?: string;
  options: KxOption<T>[];
  value: T;
  onChange: (value: T) => void;
  autoFocus?: boolean;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const step = (d: number, wrap = false) => {
    let next = index + d;
    if (wrap) next = (next + options.length) % options.length;
    next = Math.min(options.length - 1, Math.max(0, next));
    if (next !== index) onChange(options[next].value);
  };
  return (
    <Focusable
      as="div"
      className="kx-set"
      focusKey={focusKey}
      autoFocus={autoFocus}
      scrollBlock="nearest"
      onPress={() => step(1, true)}
      onArrowPress={(direction) => {
        if (direction === "left" || direction === "right") {
          step(direction === "left" ? -1 : 1);
          return false;
        }
        return true;
      }}
    >
      <span className="kx-set__head">
        <span className="kx-set__label">{label}</span>
        {note && <span className="kx-set__note">{note}</span>}
        <span className="kx-set__arrows" aria-hidden="true">
          ‹ ›
        </span>
      </span>
      <span className="kx-seg" role="radiogroup" aria-label={label}>
        {options.map((o, i) => (
          <span
            key={String(o.value)}
            role="radio"
            aria-checked={i === index}
            className={`kx-seg__opt ${i === index ? "is-on" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              if (i !== index) onChange(o.value);
            }}
          >
            {o.label}
          </span>
        ))}
      </span>
    </Focusable>
  );
}

/** A small heading inside a list (a day of the archive, «Вид субтитров»). */
export function KxSheetLabel({ children }: { children: ReactNode }) {
  return <div className="kx-sheet__label">{children}</div>;
}

/** A line of plain text inside a list (an empty list). */
export function KxSheetText({ children }: { children: ReactNode }) {
  return <p className="kx-sheet__text">{children}</p>;
}
