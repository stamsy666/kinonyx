// Decouples the generic focus/press primitives below from the app's actual sound
// engine: apps/desktop registers real handlers once at startup via setSoundHandlers,
// packages/ui itself stays audio-agnostic and just emits these two events.
export type NavSoundGroup = "menu" | undefined;

interface SoundHandlers {
  onPress?: () => void;
  onMove?: (group: NavSoundGroup) => void;
}

let handlers: SoundHandlers = {};

export function setSoundHandlers(next: SoundHandlers) {
  handlers = next;
}

export function emitPressSound() {
  handlers.onPress?.();
}

// A focus change can arrive "programmatically" — a screen mounting and auto-focusing
// its first element, the sidebar handing focus back on close, search jumping to its
// first result — none of which is the user moving the D-pad or the mouse, so none of
// it should sound like navigation (it was firing right on top of the button-press
// sound that caused it). Only an actual arrow key/gamepad-dpad keydown, tracked
// below, unlocks the navigation sound for the focus change it produces a moment
// later — mouse-driven moves are trusted directly, since a real mouseenter on a
// specific element can't happen "programmatically".
const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
let lastDirectionalInputAt = 0;

if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (e) => {
      if (ARROW_KEYS.has(e.key)) lastDirectionalInputAt = performance.now();
    },
    true,
  );
}

export function emitMoveSound(group: NavSoundGroup, byMouse?: boolean) {
  if (!byMouse && performance.now() - lastDirectionalInputAt > 100) return;
  handlers.onMove?.(group);
}
