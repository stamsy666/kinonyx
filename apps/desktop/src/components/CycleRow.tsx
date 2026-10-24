import { Focusable, NextIcon } from "@kinonyx/ui";

/**
 * A setting as one row, the tvOS way: the name on the left, the current value on the right; pressing steps to the
 * next value (the last wraps to the first). Used for the settings that have a handful of values.
 */
export function CycleRow<T>({
  label,
  focusKey,
  options,
  value,
  onChange,
  swatch,
}: {
  label: string;
  focusKey: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** A colour dot before the value (the subtitle colours). */
  swatch?: (value: T) => string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[index];
  return (
    <Focusable
      as="button"
      focusKey={focusKey}
      className="cycle-row"
      onPress={() => onChange(options[(index + 1) % options.length].value)}
    >
      <span className="cycle-row__label">{label}</span>
      <span className="cycle-row__value">
        {swatch && current && <i className="cycle-row__swatch" style={{ background: swatch(current.value) }} />}
        {current?.label}
      </span>
      <NextIcon size={20} />
    </Focusable>
  );
}
