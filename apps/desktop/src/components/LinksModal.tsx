import { Focusable, Spinner } from "@kinonyx/ui";
import { openExternal } from "../data/io";
import { Modal } from "./Modal";
import { FocusHighlight } from "./FocusHighlight";

export interface Link {
  key: string;
  title: string;
  hint?: string;
  url: string;
}

/** `links === null` means still loading. By default a press opens `url` externally;
 *  pass `onSelect` to handle it in-app instead (e.g. hand it to the internal player). */
export function LinksModal({
  heading,
  links,
  empty,
  onClose,
  onSelect,
}: {
  heading: string;
  links: Link[] | null;
  empty: string;
  onClose: () => void;
  onSelect?: (link: Link) => void;
}) {
  return (
    <Modal focusKey="links-modal" preferredChildFocusKey="link:0" onClose={onClose}>
        <div className="modal-panel__header">
          <h3>{heading}</h3>
          <Focusable as="button" className="icon-btn" focusKey="link:close" onPress={onClose} scroll={false} autoFocus={!links?.length}>
            ×
          </Focusable>
        </div>
        <div className="modal-panel__list">
          <FocusHighlight pad={0} radius="var(--radius-sm)" />
          {links === null && (
            <div style={{ display: "grid", placeItems: "center", padding: "30px 0" }}>
              <Spinner />
            </div>
          )}
          {links?.length === 0 && <p className="empty">{empty}</p>}
          {links?.map((l, i) => (
            <Focusable
              key={l.key}
              as="button"
              focusKey={`link:${i}`}
              className="list-option"
              autoFocus={i === 0}
              onPress={() => (onSelect ? onSelect(l) : void openExternal(l.url))}
            >
              <span className="list-option__title">{l.title}</span>
              {l.hint && <span className="list-option__hint">{l.hint}</span>}
            </Focusable>
          ))}
        </div>
    </Modal>
  );
}
