import { Focusable } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { previewSound, SOUND_OPTIONS, type SoundCategory } from "../data/sounds";
import { FocusHighlight } from "./FocusHighlight";

/** One row of selectable sound chips for a category, plus a "off" chip. Focusing a
 *  chip (keyboard/gamepad or mouse hover) previews that sound immediately, without
 *  changing the active choice — pressing it is what actually selects it. */
export function SoundCategoryRow({ category, focusPrefix }: { category: SoundCategory; focusPrefix: string }) {
  const choice = useApp((s) => s.soundChoice[category]);
  const volume = useApp((s) => s.sfxVolume);
  const setChoice = useApp((s) => s.setSoundChoice);
  const options = SOUND_OPTIONS[category];

  return (
    <div className="sound-options">
      <FocusHighlight pad={6} radius={16} />
      <Focusable
        as="button"
        focusKey={`${focusPrefix}:off`}
        className={`sound-option ${choice === null ? "is-active" : ""}`}
        onPress={() => setChoice(category, null)}
        mute
      >
        Без звука
      </Focusable>
      {options.map((opt, i) => (
        <Focusable
          as="button"
          key={opt.id}
          focusKey={`${focusPrefix}:${i}`}
          className={`sound-option ${choice === opt.id ? "is-active" : ""}`}
          onFocus={() => previewSound(category, opt.id, volume)}
          onPress={() => setChoice(category, opt.id)}
          mute
        >
          {opt.label}
        </Focusable>
      ))}
    </div>
  );
}
