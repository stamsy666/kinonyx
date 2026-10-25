import { Focusable, FocusGroup, PlusIcon } from "@kinonyx/ui";
import { VolumeSlider } from "./VolumeSlider";

const STEP = 0.1;

function MinusGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}

/**
 * The volume of a player, standing at the right edge of the screen while its controls are up: a vertical level to
 * take hold of (mouse) or to step with Up/Down (remote), and "−" / "+" under it. The same in the film, the channel
 * and (written out in MovieBackdrop) the trailer player.
 */
export function PlayerVolumeBar({
  volume,
  muted,
  onChange,
  onActivity,
}: {
  volume: number;
  muted: boolean;
  onChange: (v: number) => void;
  onActivity: () => void;
}) {
  const level = muted ? 0 : volume;
  const set = (v: number) => {
    onChange(Math.min(1, Math.max(0, v)));
    onActivity();
  };
  return (
    <FocusGroup focusKey="player:vbar" className="pvbar">
      <VolumeSlider focusKey="pvbar:slider" volume={level} onChange={set} step={STEP} />
      <div className="pvbar__btns">
        <Focusable as="button" className="icon-btn" focusKey="pvbar:minus" onPress={() => set(level - STEP)} scroll={false}>
          <MinusGlyph />
        </Focusable>
        <Focusable as="button" className="icon-btn" focusKey="pvbar:plus" onPress={() => set(level + STEP)} scroll={false}>
          <PlusIcon size={22} strokeWidth={2.2} />
        </Focusable>
      </div>
    </FocusGroup>
  );
}
