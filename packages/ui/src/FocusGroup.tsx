import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import type { CSSProperties, ReactNode } from "react";

interface FocusGroupProps {
  focusKey?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  preferredChildFocusKey?: string;
  isFocusBoundary?: boolean;
  saveLastFocusedChild?: boolean;
}

/** Container that scopes spatial navigation to its children (a screen, a grid, a menu). */
export function FocusGroup({
  focusKey: key,
  className,
  style,
  children,
  preferredChildFocusKey,
  isFocusBoundary,
  saveLastFocusedChild = true,
}: FocusGroupProps) {
  const { ref, focusKey } = useFocusable<HTMLDivElement>({
    focusKey: key,
    trackChildren: true,
    preferredChildFocusKey,
    isFocusBoundary,
    saveLastFocusedChild,
  });
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={className} style={style}>
        {children}
      </div>
    </FocusContext.Provider>
  );
}
