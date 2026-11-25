import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cancelGlides } from "@kinonyx/ui";

interface VolumeRowProps {
  focusKey: string;
  /** 0..1 */
  volume: number;
  onChange: (v: number) => void;
  step?: number;
  /** Text next to the track; defaults to the percentage. */
  format?: (v: number) => string;
}

/** Horizontal volume row for the settings screen — Left/Right steps it from the remote,
 *  same as before, but the track is now also clickable/draggable with a mouse (the same
 *  interaction the player's own vertical volume slider already has). */
export function VolumeRow({ focusKey, volume, onChange, step = 0.1, format }: VolumeRowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const { ref, focused, focusSelf } = useFocusable<HTMLDivElement>({
    focusKey,
    onFocus: ({ node }, _props, details) => {
      if (details?.byMouse || details?.skipScroll) return;
      cancelGlides();
      node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    },
    onArrowPress: (direction) => {
      if (direction === "left") {
        onChange(Math.max(0, volume - step));
        return false;
      }
      if (direction === "right") {
        onChange(Math.min(1, volume + step));
        return false;
      }
      return true;
    },
  });

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      onChange(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
    },
    [onChange],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => setFromClientX(e.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, setFromClientX]);

  return (
    <div
      ref={ref}
      data-fk={focusKey}
      className={`volume-row ${focused ? "is-focused" : ""}`}
      onMouseEnter={() => focusSelf({ byMouse: true })}
      onMouseDown={(e) => {
        focusSelf({ byMouse: true });
        setDragging(true);
        setFromClientX(e.clientX);
      }}
    >
      <div className="volume-row__track" ref={trackRef}>
        <i style={{ width: `${Math.round(volume * 100)}%` }} />
        <span className="volume-row__thumb" style={{ left: `${Math.round(volume * 100)}%` }} />
      </div>
      <span className="volume-row__value">{format ? format(volume) : `${Math.round(volume * 100)}%`}</span>
    </div>
  );
}
