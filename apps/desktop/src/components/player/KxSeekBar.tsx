import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useRef } from "react";

interface KxSeekBarProps {
  /** 0..1 — the place being watched. */
  progress: number;
  /** 0..1 — how far the buffer reaches (drawn lighter behind the played part). */
  buffered?: number;
  /** 0..1 each — chapter starts, drawn as small cuts in the bar. */
  marks?: number[];
  /** 0..1 — where the live broadcast is (a channel watched behind it). */
  liveEdge?: number;
  /** Seconds; turns a mouse click into a place. NaN/Infinity: clicks don't seek. */
  duration: number;
  /** The time of the picture at the knob, shown above it while the bar has the focus. */
  label?: string;
  onSeekTo: (positionSeconds: number) => void;
  onSeekBy: (deltaSeconds: number) => void;
  seekStep: number;
  onActivity: () => void;
  focusKey?: string;
}

const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const pct = (v: number) => `${(clamp(v) * 100).toFixed(3)}%`;

/**
 * The timeline of the «Кромка» player: thin (6 px) while it rests, thick (12 px) with a knob and the time over
 * it when it has the focus. Left / Right seek by `seekStep` without moving the focus off the bar; a click seeks.
 */
export function KxSeekBar({ progress, buffered, marks, liveEdge, duration, label, onSeekTo, onSeekBy, seekStep, onActivity, focusKey }: KxSeekBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const canClickSeek = Number.isFinite(duration) && duration > 0;

  const { ref, focused, focusSelf } = useFocusable<HTMLDivElement>({
    focusKey,
    onArrowPress: (direction) => {
      if (direction === "left" || direction === "right") {
        onSeekBy(direction === "left" ? -seekStep : seekStep);
        onActivity();
        return false;
      }
      return true;
    },
  });

  const seekFromClientX = (clientX: number) => {
    if (!canClickSeek || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    onSeekTo(clamp((clientX - rect.left) / rect.width) * duration);
  };

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={`kx-seek ${focused ? "is-focused" : ""} ${canClickSeek ? "kx-seek--clickable" : ""}`}
      onMouseEnter={() => focusSelf()}
      onClick={(e) => {
        focusSelf();
        seekFromClientX(e.clientX);
        onActivity();
      }}
    >
      <div className="kx-seek__track" ref={trackRef}>
        {buffered != null && buffered > 0 && <i className="kx-seek__buffer" style={{ width: pct(buffered) }} />}
        <i className="kx-seek__played" style={{ width: pct(progress) }} />
        {marks?.map((m, i) => (m > 0.002 && m < 0.998 ? <b key={i} className="kx-seek__mark" style={{ left: pct(m) }} /> : null))}
      </div>
      {liveEdge != null && <span className="kx-seek__live" style={{ left: pct(liveEdge) }} />}
      <span className="kx-seek__thumb" style={{ left: pct(progress) }} />
      {focused && label && (
        <span className="kx-seek__bubble" style={{ left: pct(progress) }}>
          {label}
        </span>
      )}
    </div>
  );
}
