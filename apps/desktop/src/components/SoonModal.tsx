import { Focusable } from "@kinonyx/ui";
import { Modal } from "./Modal";

/** A generic "not built yet" notice for buttons that already have a place in the UI
 *  (per the sketches) but no working feature behind them yet. */
export function SoonModal({ text = "Эта функция ещё в разработке.", onClose }: { text?: string; onClose: () => void }) {
  return (
    <Modal focusKey="soon" preferredChildFocusKey="soon:close" onClose={onClose}>
      <div className="modal-panel__header">
        <h3>В разработке</h3>
        <Focusable back as="button" className="icon-btn" focusKey="soon:close" onPress={onClose} scroll={false} autoFocus>
          ×
        </Focusable>
      </div>
      <p className="empty" style={{ padding: "0 20px 20px" }}>
        {text}
      </p>
    </Modal>
  );
}
