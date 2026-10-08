import { Focusable } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { applySoundKit, previewSound, SOUND_KITS } from "../data/sounds";
import { FocusHighlight } from "./FocusHighlight";

/** Ready-made sound sets. A kit fills buttons / navigation / menu navigation at once (typing
 *  is left alone); "Стандартные" puts the stock sounds back. Individual rows below still work. */
export function SoundKitRow({ focusPrefix }: { focusPrefix: string }) {
  const choice = useApp((s) => s.soundChoice);
  const volume = useApp((s) => s.sfxVolume);

  const applyKit = applySoundKit;
  const activeKit = SOUND_KITS.find((k) => k.choice.buttons === choice.buttons)?.id ?? null;

  return (
    <div className="sound-options">
      <FocusHighlight pad={6} radius={16} />
      <Focusable
        as="button"
        focusKey={`${focusPrefix}:default`}
        className={`sound-option ${activeKit === null ? "is-active" : ""}`}
        onPress={() => applyKit(null)}
        mute
      >
        Стандартные
      </Focusable>
      {SOUND_KITS.map((kit, i) => (
        <Focusable
          as="button"
          key={kit.id}
          focusKey={`${focusPrefix}:${i}`}
          className={`sound-option ${activeKit === kit.id ? "is-active" : ""}`}
          onFocus={() => previewSound("buttons", kit.choice.buttons ?? null, volume)}
          onPress={() => applyKit(kit.id)}
          mute
        >
          {kit.label}
        </Focusable>
      ))}
    </div>
  );
}
