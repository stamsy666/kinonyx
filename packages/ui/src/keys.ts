import { init, setKeyMap } from "@noriginmedia/norigin-spatial-navigation";

export const BACK_KEYS = new Set(["Escape", "Backspace", "BrowserBack", "GoBack"]);

export function initSpatialNavigation() {
  init({
    debug: false,
    visualDebug: false,
    shouldFocusDOMNode: false,
    distanceCalculationMethod: "center",
  });
  // Keyboard, WebOS remote (keyCodes) and the synthetic events emitted by the gamepad bridge.
  setKeyMap({
    left: [37, "ArrowLeft"],
    right: [39, "ArrowRight"],
    up: [38, "ArrowUp"],
    down: [40, "ArrowDown"],
    enter: [13, "Enter", " "],
  });
}

type BackHandler = () => boolean | void;
const backStack: BackHandler[] = [];

/** Registers a back handler; the most recently registered one runs first. Returns an unregister fn. */
export function onBack(handler: BackHandler) {
  backStack.push(handler);
  return () => {
    const i = backStack.lastIndexOf(handler);
    if (i >= 0) backStack.splice(i, 1);
  };
}

export function installBackKeyListener() {
  const listener = (e: KeyboardEvent) => {
    if (!BACK_KEYS.has(e.key)) return;
    if (e.key === "Backspace" && isTextInput(e.target)) return;
    for (let i = backStack.length - 1; i >= 0; i--) {
      if (backStack[i]() !== false) {
        e.preventDefault();
        return;
      }
    }
  };
  window.addEventListener("keydown", listener);
  return () => window.removeEventListener("keydown", listener);
}

export function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function dispatchKey(key: string) {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
}
