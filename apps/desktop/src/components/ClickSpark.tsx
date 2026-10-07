import { useEffect, useRef } from "react";

/**
 * Small spark lines radiating from the mouse cursor on click — a port of react-bits'
 * `ClickSpark` (https://reactbits.dev/animations/click-spark), rebuilt as a single
 * fixed full-viewport overlay instead of a `<div>` wrapping `children`: the original wraps
 * whatever it's given and listens for clicks on that wrapper, which would mean threading a
 * new wrapper element through every screen in this app (spatial-navigation `FocusGroup`s and
 * all) just to catch clicks everywhere. Mounted once near the app root instead — a
 * `pointer-events: none` canvas over everything, listening on `window`.
 *
 * `pointerType === "mouse"` (not `click`, which a keyboard/gamepad `Focusable` press never
 * fires — that path calls its `onPress` callback directly, no synthetic click — but touch
 * would) is the actual "mouse only" gate the settings toggle promises, on top of the
 * checkbox letting it be turned off outright.
 */

const SPARK_COLOR = "#ffffff";
const SPARK_SIZE = 10;
const SPARK_RADIUS = 15;
const SPARK_COUNT = 8;
const DURATION_MS = 400;

interface Spark {
  x: number;
  y: number;
  angle: number;
  startTime: number;
}

function ease(t: number) {
  return t * (2 - t); // ease-out
}

export function ClickSpark({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparks = useRef<Spark[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const now = performance.now();
      for (let i = 0; i < SPARK_COUNT; i++) {
        sparks.current.push({
          x: e.clientX,
          y: e.clientY,
          angle: (2 * Math.PI * i) / SPARK_COUNT,
          startTime: now,
        });
      }
    };
    window.addEventListener("pointerdown", onPointerDown);

    let frame = 0;
    const draw = (timestamp: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sparks.current = sparks.current.filter((spark) => {
        const elapsed = timestamp - spark.startTime;
        if (elapsed >= DURATION_MS) return false;

        const eased = ease(elapsed / DURATION_MS);
        const distance = eased * SPARK_RADIUS;
        const lineLength = SPARK_SIZE * (1 - eased);
        const x1 = spark.x + distance * Math.cos(spark.angle);
        const y1 = spark.y + distance * Math.sin(spark.angle);
        const x2 = spark.x + (distance + lineLength) * Math.cos(spark.angle);
        const y2 = spark.y + (distance + lineLength) * Math.sin(spark.angle);

        ctx.strokeStyle = SPARK_COLOR;
        ctx.globalAlpha = 1 - eased;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        return true;
      });
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", onPointerDown);
      cancelAnimationFrame(frame);
      sparks.current = [];
    };
  }, [enabled]);

  if (!enabled) return null;
  return <canvas ref={canvasRef} className="click-spark" />;
}
