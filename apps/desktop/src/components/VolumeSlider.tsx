import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface VolumeSliderProps {
  /** 0..1 */
  volume: number;
  onChange: (v: number) => void;
  onClose?: () => void;
  focusKey?: string;
  step?: number;
  autoFocus?: boolean;
}

/** Vertical volume slider: Up/Down to step, click or drag on the track to set directly, Left closes the popup. */
export function VolumeSlider({ volume, onChange, onClose, focusKey, step = 0.1, autoFocus }: VolumeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const { ref, focused, focusSelf } = useFocusable<HTMLDivElement>({
    focusKey,
    onArrowPress: (direction) => {
      if (direction === "up") {
        onChange(Math.min(1, volume + step));
        return false;
      }
      if (direction === "down") {
        onChange(Math.max(0, volume - step));
        return false;
      }
      if (direction === "left") {
        onClose?.();
        return false;
      }
      return true;
    },
  });

  useEffect(() => {
    if (autoFocus) focusSelf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  const setFromClientY = useCallback(
    (clientY: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const fraction = 1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      onChange(fraction);
    },
    [onChange],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => setFromClientY(e.clientY);
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, setFromClientY]);

  return (
    <div
      ref={ref}
      className={`volume-slider ${focused ? "is-focused" : ""}`}
      onMouseEnter={() => focusSelf()}
      onMouseDown={(e) => {
        focusSelf();
        setDragging(true);
        setFromClientY(e.clientY);
      }}
    >
      <span className="volume-slider__value">{Math.round(volume * 100)}%</span>
      <div className="volume-slider__track" ref={trackRef}>
        <i style={{ height: `${Math.round(volume * 100)}%` }} />
        <span className="volume-slider__thumb" style={{ bottom: `${Math.round(volume * 100)}%` }} />
      </div>
    </div>
  );
}
