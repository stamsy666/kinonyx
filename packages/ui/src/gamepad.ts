import { dispatchKey } from "./keys";

/**
 * Bridges the Gamepad API to keyboard events so a controller behaves like a TV remote:
 * D-pad / left stick → arrows, A → Enter, B → Back, X → Menu, Y → Info, LB/RB → seek.
 */
const STANDARD = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  select: 8,
  start: 9,
  guide: 16, // the PS / Xbox button
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

const BUTTON_TO_KEY: Record<number, string> = {
  [STANDARD.a]: "Enter",
  [STANDARD.b]: "Escape",
  [STANDARD.x]: "m",
  [STANDARD.y]: "i",
  [STANDARD.lb]: "MediaRewind",
  [STANDARD.rb]: "MediaFastForward",
  [STANDARD.start]: "p",
  [STANDARD.select]: "GamepadGuide",
  [STANDARD.guide]: "GamepadGuide",
  [STANDARD.up]: "ArrowUp",
  [STANDARD.down]: "ArrowDown",
  [STANDARD.left]: "ArrowLeft",
  [STANDARD.right]: "ArrowRight",
};

const AXIS_THRESHOLD = 0.55;
const REPEAT_DELAY = 400;
const REPEAT_RATE = 120;

interface Held {
  since: number;
  lastRepeat: number;
}

export function startGamepadBridge() {
  const held = new Map<string, Held>();
  let raf = 0;

  const press = (key: string, now: number) => {
    const h = held.get(key);
    if (!h) {
      held.set(key, { since: now, lastRepeat: now });
      dispatchKey(key);
      return;
    }
    const isArrow = key.startsWith("Arrow");
    if (isArrow && now - h.since > REPEAT_DELAY && now - h.lastRepeat > REPEAT_RATE) {
      h.lastRepeat = now;
      dispatchKey(key);
    }
  };

  const poll = () => {
    const now = performance.now();
    const active = new Set<string>();
    for (const gp of navigator.getGamepads()) {
      if (!gp) continue;
      gp.buttons.forEach((b, i) => {
        const key = BUTTON_TO_KEY[i];
        if (key && b.pressed) active.add(key);
      });
      const [x = 0, y = 0] = gp.axes;
      if (x < -AXIS_THRESHOLD) active.add("ArrowLeft");
      if (x > AXIS_THRESHOLD) active.add("ArrowRight");
      if (y < -AXIS_THRESHOLD) active.add("ArrowUp");
      if (y > AXIS_THRESHOLD) active.add("ArrowDown");
    }
    for (const key of active) press(key, now);
    for (const key of [...held.keys()]) if (!active.has(key)) held.delete(key);
    raf = requestAnimationFrame(poll);
  };

  raf = requestAnimationFrame(poll);
  return () => cancelAnimationFrame(raf);
}
