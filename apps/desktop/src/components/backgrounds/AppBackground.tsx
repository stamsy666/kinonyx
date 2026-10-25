import { useEffect } from "react";
import { Tranquiluxe, Novatrix, Velustro } from "uvcanvas";
import { BG_PALETTES, isPlainKind, type BgKind } from "../../data/backgrounds";
import { BubbleBackground } from "./BubbleBackground";
import { MonoBackground } from "./MonoBackground";
import { WavesBackground } from "./WavesBackground";

/** Velustro takes `uColor` instead of `color` — everything else here shares the
 *  same single-colour prop, so this is the one spot that needs to know the odd one out.
 *  "plasma"/"ps4"/"ps5" never reach here — AppBackground renders them separately
 *  (blend-mode SVG / plain CSS / hand-rolled WebGL, not uvcanvas shaders) — so they're
 *  excluded from `kind` and this switch stays exhaustive. */
function Effect({
  kind,
  color,
}: {
  kind: Exclude<BgKind, "plasma" | "ps4" | "ps5" | "bw">;
  color: [number, number, number];
}) {
  switch (kind) {
    case "tranquiluxe":
      return <Tranquiluxe color={color} />;
    case "novatrix":
      return <Novatrix color={color} />;
    case "velustro":
      return <Velustro uColor={color} />;
  }
}

/** Fixed full-viewport animated background, behind the whole app shell. */
export function AppBackground({ kind }: { kind: BgKind }) {
  useEffect(() => {
    // Plain themes have no canvas: the body's own (re-coloured) gradient is the background.
    if (isPlainKind(kind)) return;
    document.body.classList.add("has-canvas-bg");
    return () => document.body.classList.remove("has-canvas-bg");
  }, [kind]);

  if (isPlainKind(kind)) return null;

  if (kind === "plasma") {
    return (
      <div className="app-background">
        <BubbleBackground />
      </div>
    );
  }

  if (kind === "ps5") {
    return (
      <div className="app-background">
        <MonoBackground />
      </div>
    );
  }

  if (kind === "ps4") {
    return (
      <div className="app-background">
        <WavesBackground />
      </div>
    );
  }

  const color = BG_PALETTES[kind].colorA;
  return (
    <div className="app-background">
      {/* uvcanvas renders these fully opaque and saturated — dimmed here to sit as
          an ambient background rather than a full-bleed foreground. */}
      <div className="app-background__dim">
        <Effect kind={kind} color={color} />
      </div>
    </div>
  );
}
