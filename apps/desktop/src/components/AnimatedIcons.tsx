/**
 * Icons that move when their button gets focus (hover / remote). The motion lives in theme.css
 * (`.icon-btn.is-focused …`), so they need no state; `auto` makes the popcorn bucket play once
 * on its own, for places where there is no button to focus (a window heading).
 */

/** Popcorn bucket for "what to watch": the lid flaps open and the top bounces. */
export function PopcornIcon({ size = 24, auto = false }: { size?: number; auto?: boolean }) {
  return (
    <svg
      className={`wtw-icon ${auto ? "wtw-icon--auto" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path className="wtw-icon__flap wtw-icon__flap--l" d="m2 2 8 8" />
      <path className="wtw-icon__flap wtw-icon__flap--r" d="m22 2-8 8" />
      <ellipse className="wtw-icon__top" cx="12" cy="9" rx="10" ry="5" />
      <path d="M7 13.4v7.9" />
      <path d="M12 14v8" />
      <path d="M17 13.4v7.9" />
      <path d="M2 9v8a10 5 0 0 0 20 0V9" />
    </svg>
  );
}

/** Magnifier whose lens wobbles on focus (same motion as the stills' magnifier). */
export function SearchLensIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <g className="still-card__lens">
        <circle cx="11" cy="11" r="8" />
        <path d="M17 17L21 21" />
      </g>
    </svg>
  );
}

const CORNERS: { max: string; min: string; dx: number; dy: number }[] = [
  { max: "M8 3H5a2 2 0 0 0-2 2v3", min: "M8 3v3a2 2 0 0 1-2 2H3", dx: -1, dy: -1 },
  { max: "M21 8V5a2 2 0 0 0-2-2h-3", min: "M21 8h-3a2 2 0 0 1-2-2V3", dx: 1, dy: -1 },
  { max: "M3 16v3a2 2 0 0 0 2 2h3", min: "M3 16h3a2 2 0 0 1 2 2v3", dx: -1, dy: 1 },
  { max: "M16 21h3a2 2 0 0 0 2-2v-3", min: "M16 21v-3a2 2 0 0 1 2-2h3", dx: 1, dy: 1 },
];

/** Four corners: "maximize" pushes them outward on focus, "minimize" (already full screen) pulls them in. */
export function FullscreenCornersIcon({ size = 24, exit = false }: { size?: number; exit?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      {CORNERS.map((c, i) => (
        <path key={i} className="fs-corner" style={{ "--dx": exit ? -c.dx : c.dx, "--dy": exit ? -c.dy : c.dy } as React.CSSProperties} d={exit ? c.min : c.max} />
      ))}
    </svg>
  );
}

/** Settings cog: turns half a revolution on focus and back when focus leaves. */
export function SettingsCogIcon({ size = 24 }: { size?: number }) {
  return (
    <svg className="gear-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
