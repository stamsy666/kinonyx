const OUT_MS = 280;
const HOLD_MS = 140;
const IN_MS = 360;
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

let running = false;

/**
 * A soft hand-over to a dark screen: the page fades out to black, `action` runs under the black (the player
 * opens), and the black then fades away by itself, so the channel does not cut in. Presses during the transition
 * are swallowed (the layer is on top and takes them). With reduced motion the action just runs.
 *
 * Every step also has a timer behind it: where the animation clock is held (a window that is not shown), the
 * action still runs and the layer still goes away.
 */
export function fadeThrough(action: () => void): boolean {
  if (running) return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    action();
    return true;
  }
  running = true;
  const layer = document.createElement("div");
  layer.className = "kx-fade";
  document.body.append(layer);

  let acted = false;
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    layer.remove();
    running = false;
  };
  const fadeAway = () => {
    layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: IN_MS, easing: EASE, fill: "forwards" }).onfinish = remove;
    window.setTimeout(remove, IN_MS + 400);
  };
  const act = () => {
    if (acted) return;
    acted = true;
    action();
    window.setTimeout(fadeAway, HOLD_MS);
  };

  layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OUT_MS, easing: EASE, fill: "forwards" }).onfinish = act;
  window.setTimeout(act, OUT_MS + 120);
  return true;
}
