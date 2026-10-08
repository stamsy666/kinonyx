/**
 * Fast, never-queued scrolling for horizontal shelves.
 *
 * `scrollIntoView({ behavior: "smooth" })` (plus the shelf's CSS scroll-snap) restarts a browser
 * animation on every focus step, so holding an arrow trails behind the focus and the shelf
 * ends up somewhere else than the card you are on. Here every step only re-aims ONE glide per
 * scroll container: an exponential ease toward the latest target, so the picture always keeps up
 * and settles on the right card the moment you stop.
 */

interface Glide {
  tx: number;
  ty: number;
  tau: number;
  raf: number;
}

const glides = new WeakMap<HTMLElement, Glide>();
const running = new Set<HTMLElement>();

/** Stops every running glide where it is. Anything else that moves a scroll position (a screen
 *  change, the browser's own scrollIntoView, the viewer's wheel) calls this first — a glide left
 *  running would keep pulling the page back toward its old target. */
export function cancelGlides() {
  for (const c of running) {
    const g = glides.get(c);
    if (g?.raf) cancelAnimationFrame(g.raf);
    if (g) g.raf = 0;
  }
  running.clear();
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Where the container is heading (or is, if idle). */
function pending(c: HTMLElement): Glide {
  let g = glides.get(c);
  if (!g) {
    g = { tx: c.scrollLeft, ty: c.scrollTop, tau: 55, raf: 0 };
    glides.set(c, g);
  }
  if (!g.raf) {
    // Idle: start from where the container really is (the viewer may have scrolled by hand).
    g.tx = c.scrollLeft;
    g.ty = c.scrollTop;
  }
  return g;
}

function run(c: HTMLElement, g: Glide) {
  if (g.raf) return;
  running.add(c);
  // The viewer's own wheel scroll wins over a glide in progress.
  c.addEventListener("wheel", cancelGlides, { passive: true, once: true });
  let last = performance.now();
  const tick = (t: number) => {
    const k = 1 - Math.exp(-(t - last) / g.tau);
    last = t;
    const dx = g.tx - c.scrollLeft;
    const dy = g.ty - c.scrollTop;
    if (Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6) {
      c.scrollLeft = g.tx;
      c.scrollTop = g.ty;
      g.raf = 0;
      running.delete(c);
      return;
    }
    c.scrollLeft += dx * k;
    c.scrollTop += dy * k;
    g.raf = requestAnimationFrame(tick);
  };
  g.raf = requestAnimationFrame(tick);
}

function scrollableY(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}

/**
 * Brings `el` into view inside its shelf (`.row-scroll__track`, horizontally: just far enough, like
 * `inline: "nearest"`) and inside the page's scrolling body (vertically, as `block`).
 */
export function glideIntoView(el: HTMLElement, block: ScrollLogicalPosition, track: HTMLElement) {
  const r = el.getBoundingClientRect();

  // ---- horizontal, in the shelf ----
  const tr = track.getBoundingClientRect();
  const padX = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 12;
  const gx = pending(track);
  const left = r.left - tr.left + track.scrollLeft; // content coordinates: stable while the shelf is moving
  const right = left + r.width;
  let tx = gx.tx;
  if (left < tx + padX) tx = left - padX;
  else if (right > tx + track.clientWidth - padX) tx = right - track.clientWidth + padX;
  gx.tx = clamp(tx, 0, track.scrollWidth - track.clientWidth);
  gx.tau = 55;
  run(track, gx);

  // ---- vertical, in the page body ----
  const page = scrollableY(track);
  if (page) {
    const pr = page.getBoundingClientRect();
    const gy = pending(page);
    const top = r.top - pr.top + page.scrollTop;
    const bottom = top + r.height;
    const padY = 24;
    let ty = gy.ty;
    if (block === "center") ty = top - (page.clientHeight - r.height) / 2;
    else if (block === "start") ty = top - padY;
    else if (top < ty + padY) ty = top - padY;
    else if (bottom > ty + page.clientHeight - padY) ty = bottom - page.clientHeight + padY;
    gy.ty = clamp(ty, 0, page.scrollHeight - page.clientHeight);
    gy.tau = 80;
    run(page, gy);
  }
}
