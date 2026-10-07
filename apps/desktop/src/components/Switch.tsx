import { Focusable } from "@kinonyx/ui";

/** On/off switch (pill track + sliding thumb) for settings — focusable like any button. */
export function Switch({ on, onChange, focusKey }: { on: boolean; onChange: (on: boolean) => void; focusKey: string }) {
  return (
    <Focusable as="button" focusKey={focusKey} className={`switch ${on ? "is-on" : ""}`} onPress={() => onChange(!on)} scroll={false}>
      <span className="switch__track">
        <span className="switch__thumb" />
      </span>
      <span className="switch__label">{on ? "Вкл" : "Выкл"}</span>
    </Focusable>
  );
}
