/**
 * "Аврора" theme background — a plain-CSS port of Aceternity's Aurora Background
 * (https://ui.aceternity.com/components/aurora-background), rebuilt without Tailwind or
 * `motion/react` (neither is in this app) to fit KINONYX's existing `.app-background`
 * wrapper and theme system, alongside the other (WebGL/uvcanvas) theme effects.
 *
 * The original toggles a light/dark variant (and inverts the aurora layer for light mode);
 * KINONYX has no light mode, so only its dark variant is kept — two moving striped gradient
 * layers (`.aurora-bg` and its `::after`, blended with `mix-blend-mode: difference`) animate
 * along `background-position` (see `@keyframes kx-aurora` in theme.css), masked to fade out
 * away from the top of the screen.
 */
export function AuroraBackground() {
  return (
    <div className="aurora-bg-wrap">
      <div className="aurora-bg" />
    </div>
  );
}
