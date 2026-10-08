/**
 * "PS4" theme background — slow drifting blue waves, after the PlayStation 4 menu.
 * Three oversized rounded squares turn around a point a little off their centre, so their
 * edges sweep across the screen like swells; each layer has its own speed (and one runs
 * backwards), so the pattern never repeats in an obvious loop. Pure CSS (`.ps4-bg` in theme.css),
 * transform-only animation — it costs the GPU next to nothing.
 */
export function WavesBackground() {
  return (
    <div className="ps4-bg" aria-hidden="true">
      <div className="ps4-bg__wave ps4-bg__wave--one" />
      <div className="ps4-bg__wave ps4-bg__wave--two" />
      <div className="ps4-bg__wave ps4-bg__wave--three" />
      <div className="ps4-bg__shade" />
    </div>
  );
}
