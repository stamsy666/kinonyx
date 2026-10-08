import { useEffect, useRef } from "react";

/**
 * "Мгла" theme background — the "Bloom Field" mesh gradient from 21st.dev/community/gradients:
 * one soft radial blob per colour on a black backdrop, each drifting slowly around its own
 * anchor point. Plain CSS gradient layers rewritten every frame (no canvas/WebGL), so it is
 * cheap and has no GL context to tear down.
 *
 * Motion follows the export's recipe: every offset is `sin(x + p) - sin(p)` with a STATIC
 * per-blob phase `p`, so it is exactly 0 at t = 0 (no jump when the animation starts) and
 * continuous after — nothing is rounded per frame, which is what would make it visibly step.
 */

interface Blob {
  rgb: string;
  /** Anchor, % of the box. */
  x: number;
  y: number;
  /** Radius where the blob has faded out completely, % of the gradient box. */
  r: number;
  /** Static phase offsets, one per axis. */
  p: number;
  p2: number;
}

const BLOBS: Blob[] = [
  { rgb: "52, 52, 50", x: 65.34, y: 44.62, r: 34.1 },
  { rgb: "18, 18, 17", x: 28.07, y: 74.48, r: 44.6 },
  { rgb: "52, 52, 50", x: 52.42, y: 19.94, r: 56.5 },
  { rgb: "0, 0, 0", x: 80.31, y: 84.47, r: 69.1 },
].map((b, i) => ({ ...b, p: (i + 1) * 2.399963, p2: (i + 1) * 4.1 + 1.3 }));

const SPEED = 0.77;
const AMOUNT = 1;
/** How far a blob wanders from its anchor, in % of the box. */
const SWAY = 14;
/** Opacity across the radius: centre → edge (the export's smooth falloff). */
const FALLOFF = [1, 0.844, 0.5, 0.156, 0];

function layer(b: Blob, t: number): string {
  const ph = t * SPEED;
  const x = b.x + (Math.sin(ph * 0.55 + b.p) - Math.sin(b.p)) * SWAY * AMOUNT;
  const y = b.y + (Math.sin(ph * 0.43 + b.p2) - Math.sin(b.p2)) * SWAY * AMOUNT;
  const stops = FALLOFF.map((a, i) => `rgba(${b.rgb}, ${a}) ${((b.r * i) / 4).toFixed(2)}%`).join(", ");
  return `radial-gradient(circle at ${x.toFixed(3)}% ${y.toFixed(3)}%, ${stops})`;
}

export function BloomBackground() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const paint = (t: number) => {
      el.style.backgroundImage = BLOBS.map((b) => layer(b, t)).join(", ");
    };
    paint(0);

    // Same lifecycle as the other animated themes: idle while hidden/off-screen, so a
    // minimized window doesn't keep repainting.
    let raf = 0;
    let isVisible = true;
    let isPageVisible = !document.hidden;
    const t0 = performance.now();
    const loop = (now: number) => {
      paint((now - t0) * 0.001);
      raf = requestAnimationFrame(loop);
    };
    const tryStart = () => {
      if (isVisible && isPageVisible && raf === 0) raf = requestAnimationFrame(loop);
    };
    const tryStop = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const io = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
      isVisible ? tryStart() : tryStop();
    });
    io.observe(el);
    const onVisibility = () => {
      isPageVisible = !document.hidden;
      isPageVisible ? tryStart() : tryStop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    tryStart();

    return () => {
      tryStop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <div ref={ref} style={{ position: "absolute", inset: 0, backgroundColor: "#000000" }} />;
}
