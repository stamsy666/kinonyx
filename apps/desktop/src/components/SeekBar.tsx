import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useRef } from "react";

interface SeekBarProps {
  /** 0..1 */
  progress: number;
  /** Seconds; used to translate a mouse click into a seek target. NaN/Infinity disables click-to-seek. */
  duration: number;
  onSeekTo: (positionSeconds: number) => void;
  onSeekBy: (deltaSeconds: number) => void;
  seekStep: number;
  onActivity: () => void;
  focusKey?: string;
}

/** The playback timeline: focusable so Left/Right scrub without moving focus
 *  off the bar, and click-to-seek with the mouse. */
export function SeekBar({ progress, duration, onSeekTo, onSeekBy, seekStep, onActivity, focusKey }: SeekBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const canClickSeek = Number.isFinite(duration) && duration > 0;

  const { ref, focused, focusSelf } = useFocusable<HTMLDivElement>({
    focusKey,
    onArrowPress: (direction) => {
      if (direction === "left") {
        onSeekBy(-seekStep);
        onActivity();
        return false;
      }
      if (direction === "right") {
        onSeekBy(seekStep);
        onActivity();
        return false;
      }
      return true;
    },
  });

  const seekFromClientX = (clientX: number) => {
    if (!canClickSeek || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeekTo(fraction * duration);
  };

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={`focusable seekbar ${focused ? "is-focused" : ""} ${canClickSeek ? "seekbar--clickable" : ""}`}
      onMouseEnter={() => focusSelf()}
      onClick={(e) => {
        focusSelf();
        seekFromClientX(e.clientX);
        onActivity();
      }}
    >
      <div className="seekbar__track" ref={trackRef}>
        <i style={{ width: `${Math.round(progress * 100)}%` }} />
        <span className="seekbar__thumb" style={{ left: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  );
}
