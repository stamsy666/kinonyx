import type { ReactNode } from "react";

/**
 * "Nothing here" / "couldn't load" in the app's own look: a glass card with a large icon, a bold line and a quieter hint
 * under it — instead of a bare grey sentence on the background.
 */
export function EmptyState({ icon, title, hint, error }: { icon: ReactNode; title: string; hint?: string; error?: boolean }) {
  return (
    <div className={`empty-state ${error ? "empty-state--error" : ""}`} role="status">
      <div className="empty-state__icon">{icon}</div>
      <div className="empty-state__title">{title}</div>
      {hint && <div className="empty-state__hint">{hint}</div>}
    </div>
  );
}
