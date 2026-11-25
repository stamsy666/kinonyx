import { Focusable, GlobeIcon } from "@kinonyx/ui";

export type SearchKeyMode = "ru" | "en" | "sym";

const KEYS: Record<SearchKeyMode, string[]> = {
  ru: Array.from("абвгдеёжзийклмнопрстуфхцчшщъыьэюя"),
  en: Array.from("abcdefghijklmnopqrstuvwxyz"),
  sym: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "\x60", "'", '"', ";", ":", "~", "=", "*", "+", "-", "_", ",", ".", "?", "!", "@", "#", "₽", "%", "^", "&", "|", "/", "\\", "(", ")", "[", "]", "{", "}", "<", ">"],
};

interface Props {
  prefix: string;
  mode: SearchKeyMode;
  onModeChange: (mode: SearchKeyMode) => void;
  onType: (key: string) => void;
  onErase: () => void;
  onClear: () => void;
  onRight?: () => boolean;
  autoFocus?: boolean;
  scroll?: boolean;
}

export function SearchKeys({ prefix, mode, onModeChange, onType, onErase, onClear, onRight, autoFocus, scroll = false }: Props) {
  const moveRight = (direction: string) => direction !== "right" || !onRight?.();
  return (
    <>
      <div className="sx__modes">
        <Focusable as="button" className="sx__mode sx__mode--globe" focusKey={prefix + ":lang"} scroll={scroll}
          scrollBlock="nearest" autoFocus={autoFocus} onPress={() => onModeChange(mode === "ru" ? "en" : "ru")}>
          <GlobeIcon size={26} />
        </Focusable>
        <Focusable as="button" className={"sx__mode" + (mode !== "sym" ? " is-active" : "")}
          focusKey={prefix + ":letters"} scroll={scroll} scrollBlock="nearest"
          onPress={() => onModeChange(mode === "sym" ? "ru" : mode)}>
          {mode === "en" ? "abc" : "абв"}
        </Focusable>
        <Focusable as="button" className={"sx__mode" + (mode === "sym" ? " is-active" : "")}
          focusKey={prefix + ":symbols"} scroll={scroll} scrollBlock="nearest" onArrowPress={moveRight} onPress={() => onModeChange("sym")}>
          123
        </Focusable>
      </div>
      <div className="sx__keys">
        {KEYS[mode].map((key, index) => (
          <Focusable key={mode + ":" + key} as="button" className="sx__key" focusKey={prefix + ":key:" + index}
            onArrowPress={index % 6 === 5 || index === KEYS[mode].length - 1 ? moveRight : undefined}
            scroll={scroll} scrollBlock="nearest" mute onPress={() => onType(key)}>
            {key}
          </Focusable>
        ))}
      </div>
      <div className="sx__actions">
        <Focusable as="button" className="sx__action" focusKey={prefix + ":space"} scroll={scroll} scrollBlock="nearest" mute onPress={() => onType(" ")}>
          ПРОБЕЛ
        </Focusable>
        <Focusable as="button" className="sx__action sx__action--icon" focusKey={prefix + ":erase"} scroll={scroll}
          scrollBlock="nearest" mute onPress={onErase}>
          <svg width="30" height="24" viewBox="0 0 30 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H10L2 12z" />
            <path d="M16 8l8 8M24 8l-8 8" />
          </svg>
        </Focusable>
        <Focusable as="button" className="sx__action" focusKey={prefix + ":clear"} scroll={scroll} scrollBlock="nearest" onArrowPress={moveRight} onPress={onClear}>
          ОЧИСТИТЬ
        </Focusable>
      </div>
    </>
  );
}
