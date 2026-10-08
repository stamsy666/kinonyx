import { useEffect } from "react";
import { Tranquiluxe, Novatrix, Velustro, Opulento, Lumiflex } from "uvcanvas";
import { BG_PALETTES, isPlainKind, type BgKind } from "../../data/backgrounds";
import { AuroraBackground } from "./AuroraBackground";
import { CloudBackground } from "./CloudBackground";
import { BubbleBackground } from "./BubbleBackground";
import { BloomBackground } from "./BloomBackground";
import { MonoBackground } from "./MonoBackground";
import { WavesBackground } from "./WavesBackground";

/** Velustro takes `uColor` instead of `color` — everything else here shares the
 *  same single-colour prop, so this is the one spot that needs to know the odd one out.
 *  "aurora"/"cloud"/"plasma" never reach here — AppBackground renders them separately
 *  (plain CSS / hand-rolled WebGL / blend-mode SVG, not uvcanvas shaders) — so they're
 *  excluded from `kind` and this switch stays exhaustive. */
function Effect({
  kind,
  color,
}: {
  kind: Exclude<BgKind, "aurora" | "cloud" | "plasma" | "bloom" | "mono" | "ps4" | "ps5" | "light" | "bw">;
  color: [number, number, number];
}) {
  switch (kind) {
    case "tranquiluxe":
      return <Tranquiluxe color={color} />;
    case "novatrix":
      return <Novatrix color={color} />;
    case "velustro":
      return <Velustro uColor={color} />;
    case "opulento":
      return <Opulento color={color} />;
    case "lumiflex":
      return <Lumiflex color={color} />;
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

  if (kind === "aurora") {
    return (
      <div className="app-background">
        <AuroraBackground />
      </div>
    );
  }

  if (kind === "cloud") {
    return (
      <div className="app-background">
        <CloudBackground />
      </div>
    );
  }

  if (kind === "plasma") {
    return (
      <div className="app-background">
        <BubbleBackground />
      </div>
    );
  }

  if (kind === "mono" || kind === "ps5") {
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

  if (kind === "bloom") {
    return (
      <div className="app-background">
        <BloomBackground />
      </div>
    );
  }

  const color = BG_PALETTES[kind].colorA;
  return (
    <div className="app-background">
      {/* uvcanvas renders these fully opaque and saturated — dimmed here to sit as
          an ambient background rather than a full-bleed foreground. */}
      <div
        className={`app-background__dim ${kind === "opulento" ? "app-background__dim--blur" : ""}`}
      >
        <Effect kind={kind} color={color} />
      </div>
    </div>
  );
}
