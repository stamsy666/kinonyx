import { Focusable } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { applySoundKit, previewSoundKit, SOUND_KITS } from "../data/sounds";
import { FocusHighlight } from "./FocusHighlight";

export function SoundKitRow({ focusPrefix }: { focusPrefix: string }) {
  const selected = useApp((s) => s.soundKit);
  const volume = useApp((s) => s.sfxVolume);

  return (
    <div className="sound-options">
      <FocusHighlight pad={6} radius={16} />
      {Object.values(SOUND_KITS).map((kit) => (
        <Focusable
          as="button"
          key={kit.id}
          focusKey={`${focusPrefix}:${kit.id}`}
          className={`sound-option ${selected === kit.id ? "is-active" : ""}`}
          onFocus={() => previewSoundKit(kit.id, volume)}
          onPress={() => applySoundKit(kit.id)}
          mute
        >
          {kit.label}
        </Focusable>
      ))}
    </div>
  );
}
