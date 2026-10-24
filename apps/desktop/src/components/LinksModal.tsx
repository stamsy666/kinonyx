import { Focusable, NextIcon, Spinner } from "@kinonyx/ui";
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
  tv,
}: {
  heading: string;
  links: Link[] | null;
  empty: string;
  onClose: () => void;
  onSelect?: (link: Link) => void;
  /** The settings look: a centred title and pill rows (name left, address right), no close button. */
  tv?: boolean;
}) {
  if (tv) {
    return (
      <Modal focusKey="links-modal" preferredChildFocusKey="link:0" className="links-tv" onClose={onClose}>
        <h3 className="links-tv__title">{heading}</h3>
        <div className="links-tv__list">
          {links === null && (
            <div className="links-tv__wait">
              <Spinner />
            </div>
          )}
          {links?.length === 0 && <p className="links-tv__text">{empty}</p>}
          {links?.map((l, i) => (
            <Focusable
              key={l.key}
              as="button"
              focusKey={`link:${i}`}
              className="links-tv__row"
              autoFocus={i === 0}
              onPress={() => (onSelect ? onSelect(l) : void openExternal(l.url))}
            >
              <span className="links-tv__name">{l.title}</span>
              {l.hint && <span className="links-tv__hint">{l.hint}</span>}
              <NextIcon size={20} />
            </Focusable>
          ))}
          <Focusable as="button" back focusKey="link:close" className="links-tv__row links-tv__row--close" scroll={false} onPress={onClose}>
            <span className="links-tv__name">Закрыть</span>
          </Focusable>
        </div>
      </Modal>
    );
  }
  return (
    <Modal focusKey="links-modal" preferredChildFocusKey="link:0" onClose={onClose}>
        <div className="modal-panel__header">
          <h3>{heading}</h3>
          <Focusable back as="button" className="icon-btn" focusKey="link:close" onPress={onClose} scroll={false} autoFocus={!links?.length}>
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
