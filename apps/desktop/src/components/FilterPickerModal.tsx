import { useState } from "react";
import { Focusable, Spinner } from "@kinonyx/ui";
import { Modal } from "./Modal";
import { FocusHighlight } from "./FocusHighlight";

export interface PickOption {
  key: string;
  title: string;
}

/**
 * A choice window for a search filter (genre / year / rating): the page behind is dimmed and
 * blurred like every other window; pressing an option only *marks* it, and the choice takes
 * effect with the "Применить" button at the bottom. `options === null` = still loading.
 */
export function FilterPickerModal({
  heading,
  options,
  value,
  empty = "Ничего не загрузилось",
  onApply,
  onClose,
}: {
  heading: string;
  options: PickOption[] | null;
  /** Key of the option currently applied. */
  value: string;
  empty?: string;
  onApply: (key: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(value);
  const firstFocus = options?.findIndex((o) => o.key === value) ?? 0;

  return (
    <Modal focusKey="filter-modal" preferredChildFocusKey={`filter:opt:${Math.max(0, firstFocus)}`} className="filter-modal" onClose={onClose}>
      <div className="modal-panel__header">
        <h3>{heading}</h3>
        <Focusable back as="button" className="icon-btn" focusKey="filter:close" onPress={onClose} scroll={false}>
          ×
        </Focusable>
      </div>
      <div className="modal-panel__list">
        <FocusHighlight pad={0} radius="var(--radius-sm)" />
        {options === null && (
          <div style={{ display: "grid", placeItems: "center", padding: "30px 0" }}>
            <Spinner />
          </div>
        )}
        {options?.length === 0 && <p className="empty">{empty}</p>}
        {options?.map((o, i) => (
          <Focusable
            key={o.key}
            as="button"
            focusKey={`filter:opt:${i}`}
            className={`list-option list-option--row ${picked === o.key ? "is-picked" : ""}`}
            autoFocus={i === Math.max(0, firstFocus)}
            onPress={() => setPicked(o.key)}
          >
            <span className="list-option__title">{o.title}</span>
            {picked === o.key && (
              <svg className="list-option__check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </Focusable>
        ))}
      </div>
      <div className="filter-modal__footer">
        <Focusable as="button" className="btn btn--primary" focusKey="filter:apply" scroll={false} onPress={() => onApply(picked)}>
          Применить
        </Focusable>
      </div>
    </Modal>
  );
}
