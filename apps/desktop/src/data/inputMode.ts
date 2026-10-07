import { useApp } from "../store/app";

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"]);

/**
 * Tracks whether the viewer is currently driving the app with the mouse or with
 * arrow keys/remote/gamepad — the gamepad bridge (`@kinonyx/ui`'s `startGamepadBridge`)
 * dispatches real `KeyboardEvent`s, so one keydown listener already covers both.
 *
 * Used to decide whether a floating "always visible" control (a detail page's back
 * button) earns its keep: a mouse has no hardware Back button, so keeping one on
 * screen matters; a remote/keyboard already has one (`onBack`'s Escape/Backspace),
 * so the on-screen button can just sit in the normal scrolling flow instead.
 */
export function installInputModeTracker() {
  const setMode = (mode: "mouse" | "keys") => useApp.getState().setInputMode(mode);
  const onMouseMove = () => setMode("mouse");
  const onKeyDown = (e: KeyboardEvent) => {
    if (ARROW_KEYS.has(e.key)) setMode("keys");
  };
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mousedown", onMouseMove);
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mousedown", onMouseMove);
    window.removeEventListener("keydown", onKeyDown, true);
  };
}
