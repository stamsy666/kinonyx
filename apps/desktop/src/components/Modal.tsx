import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { doesFocusableExist, getCurrentFocusKey, setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { FocusGroup, onBack } from "@kinonyx/ui";
import { useApp } from "../store/app";

interface Props {
  focusKey: string;
  preferredChildFocusKey?: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Dimmed backdrop + centred panel, rendered straight into <body>.
 *
 * Rendered in place, a modal sat inside the screen wrapper, which animates `transform`
 * on enter — and a transformed ancestor becomes the containing block for `position:
 * fixed`. The panel was then centred on the (tall, scrolled) page instead of the window,
 * landing well below the middle, and the `inset: 0` backdrop dimmed only the page's box —
 * a visible darker rectangle with hard edges instead of the whole window. React context
 * (spatial navigation's FocusContext included) passes through the portal unchanged.
 */
export function Modal({ focusKey, preferredChildFocusKey, className = "", onClose, children }: Props) {
  // Centralised here so every modal built on this component closes on Escape/Backspace/
  // remote-Back without each caller having to remember its own `onBack` registration —
  // a caller that needs different back behaviour (ReleasePickerModal's "step back a
  // stage, not all the way out") still wins: its own `onBack` is registered after this
  // one (it wraps `<Modal>`, so its effect commits later) and the stack runs last-in-first.
  useEffect(() => onBack(() => (onClose(), true)), [onClose]);

  // Read during the first render — before the modal's own autoFocus moves focus inside.
  // On close the focused item unmounts with the panel, and unless something else took
  // focus, the remote was left pointing at nothing: arrows did nothing until a mouse
  // hover picked a new item. Hand focus back to the control that opened the modal
  // instead — unless the modal navigated elsewhere (that screen places its own focus).
  const [returnTo] = useState(() => ({ key: getCurrentFocusKey(), screen: useApp.getState().screen }));
  useEffect(
    () => () => {
      window.setTimeout(() => {
        if (useApp.getState().screen !== returnTo.screen) return;
        const current = getCurrentFocusKey();
        if (current && doesFocusableExist(current)) return;
        if (returnTo.key && doesFocusableExist(returnTo.key)) void setFocus(returnTo.key);
      }, 50);
    },
    [returnTo],
  );

  return createPortal(
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <FocusGroup focusKey={focusKey} className={`modal-panel ${className}`} isFocusBoundary preferredChildFocusKey={preferredChildFocusKey}>
        {children}
      </FocusGroup>
    </>,
    document.body,
  );
}
