import { useEffect, useRef, type CSSProperties } from "react";

/**
 * "Плазма" theme background — a plain-CSS/SVG port of nyxui's Bubble Background
 * (https://nyxui.com — `bubble-background.json`, no dependencies beyond an SVG filter and
 * six blended, animated radial gradients — nothing WebGL here, unlike the shader themes).
 * Algorithm untouched: an SVG "goo" filter (two Gaussian blurs into a sharpened alpha
 * threshold via `feColorMatrix`) makes the blurred, overlapping circular gradients below it
 * fuse into smooth blobs instead of just looking like blurry circles; five of them drift on
 * fixed loops (`bounceV`/`bounceH`/`moveInCircle`), a sixth follows the mouse (eased toward
 * the pointer every frame — the one genuinely interactive theme background here, kept as-is
 * since KINONYX already has other mouse-only flourishes, e.g. `ClickSpark.tsx`).
 *
 * Colours are fixed constants instead of the original's props (this theme is one specific
 * look, not a configurable component); dimmed via `.bubble-bg`'s opacity the same way the
 * cloud-shader theme is — the blend-mode blobs are vivid by design and need taming to sit
 * behind text rather than in front of it.
 */

const BG_A = "rgb(64, 0, 96)";
const BG_B = "rgb(0, 12, 58)";
const COLORS = {
  a: "18, 113, 255",
  b: "221, 74, 255",
  c: "100, 220, 255",
  d: "220, 60, 90",
  e: "200, 190, 70",
  interactive: "160, 110, 255",
};
const BLEND: CSSProperties["mixBlendMode"] = "hard-light";
const SIZE = "80%";

export function BubbleBackground() {
  const interactiveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let curX = 0;
    let curY = 0;
    let tgX = 0;
    let tgY = 0;
    const ease = 10;
    let frame = 0;
    let running = true;

    const move = () => {
      if (!running) return;
      if (interactiveRef.current) {
        curX += (tgX - curX) / ease;
        curY += (tgY - curY) / ease;
        interactiveRef.current.style.transform = `translate(${curX}px, ${curY}px)`;
      }
      frame = requestAnimationFrame(move);
    };
    const onPointerMove = (e: PointerEvent) => {
      tgX = e.clientX;
      tgY = e.clientY;
    };
    window.addEventListener("pointermove", onPointerMove);
    frame = requestAnimationFrame(move);

    // The window minimized, or another app fronted: don't keep easing/painting for nothing.
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(frame);
      } else if (!running) {
        running = true;
        frame = requestAnimationFrame(move);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(frame);
    };
  }, []);

  const top = `calc(50% - ${SIZE} / 2)`;
  const left = top;
  const blob = (color: string, alpha: number) =>
    `radial-gradient(circle at center, rgba(${color}, ${alpha}) 0, rgba(${color}, 0) 50%)`;

  return (
    <div
      className="bubble-bg"
      style={{ background: `linear-gradient(40deg, ${BG_A}, ${BG_B})` }}
    >
      <svg className="bubble-bg__defs" aria-hidden>
        <filter id="kx-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8"
            result="goo"
          />
          <feBlend in="SourceGraphic" in2="goo" />
        </filter>
      </svg>
      <div className="bubble-bg__field">
        <div
          className="bubble-bg__blob"
          style={{
            width: SIZE,
            height: SIZE,
            top,
            left,
            background: blob(COLORS.a, 0.8),
            mixBlendMode: BLEND,
            transformOrigin: "center center",
            animation: "kx-bounce-v 30s ease infinite",
          }}
        />
        <div
          className="bubble-bg__blob"
          style={{
            width: SIZE,
            height: SIZE,
            top,
            left,
            background: blob(COLORS.b, 0.8),
            mixBlendMode: BLEND,
            transformOrigin: "calc(50% - 400px)",
            animation: "kx-move-in-circle 20s reverse infinite",
          }}
        />
        <div
          className="bubble-bg__blob"
          style={{
            width: SIZE,
            height: SIZE,
            top: `calc(50% - ${SIZE} / 2 + 200px)`,
            left: `calc(50% - ${SIZE} / 2 - 500px)`,
            background: blob(COLORS.c, 0.8),
            mixBlendMode: BLEND,
            transformOrigin: "calc(50% + 400px)",
            animation: "kx-move-in-circle 40s linear infinite",
          }}
        />
        <div
          className="bubble-bg__blob"
          style={{
            width: SIZE,
            height: SIZE,
            top,
            left,
            background: blob(COLORS.d, 0.7),
            mixBlendMode: BLEND,
            transformOrigin: "calc(50% - 200px)",
            animation: "kx-bounce-h 40s ease infinite",
          }}
        />
        <div
          className="bubble-bg__blob"
          style={{
            width: `calc(${SIZE} * 2)`,
            height: `calc(${SIZE} * 2)`,
            top: `calc(50% - ${SIZE})`,
            left: `calc(50% - ${SIZE})`,
            background: blob(COLORS.e, 0.8),
            mixBlendMode: BLEND,
            transformOrigin: "calc(50% - 800px) calc(50% + 200px)",
            animation: "kx-move-in-circle 20s ease infinite",
          }}
        />
        <div
          ref={interactiveRef}
          className="bubble-bg__blob bubble-bg__blob--interactive"
          style={{
            background: blob(COLORS.interactive, 0.7),
            mixBlendMode: BLEND,
          }}
        />
      </div>
    </div>
  );
}
