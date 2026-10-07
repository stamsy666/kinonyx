const DOTS = Array.from({ length: 12 });

/** A classic 12-dot activity indicator, CSS-driven. */
export function Spinner() {
  return (
    <div className="spinner" role="status" aria-hidden="true">
      {DOTS.map((_, i) => (
        <i key={i} style={{ transform: `rotate(${i * 30}deg)`, animationDelay: `${(i * -1) / 12}s` }} />
      ))}
    </div>
  );
}
