import { createPortal } from "react-dom";
import { BackIcon, Focusable } from "@kinonyx/ui";

/**
 * Portalled to <body> for the same reason as MovieBackdrop: `.screen-pad`'s mount
 * animation leaves the element with an active (fill-mode) transform even once it's
 * finished — Chromium serialises its "none" end state as `matrix(1,0,0,1,0,0)`, which
 * still counts as "a transform" for CSS purposes and turns `position: fixed` children
 * into "fixed to that ancestor" instead of the viewport. Rendering outside that
 * subtree is the only way to actually stay pinned to the screen while it scrolls.
 */
export function DetailBackButton({ focusKey, onPress, autoFocus }: { focusKey: string; onPress: () => void; autoFocus?: boolean }) {
  return createPortal(
    <Focusable back as="button" className="icon-btn detail-back" focusKey={focusKey} onPress={onPress} scroll={false} autoFocus={autoFocus}>
      <BackIcon />
    </Focusable>,
    document.body,
  );
}
