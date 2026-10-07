import { navigateByDirection, pause, resume } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Focusable } from "@kinonyx/ui";
import { playCategorySound } from "../data/sounds";

interface TextFieldProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: (v: string) => void;
  placeholder?: string;
  icon?: ReactNode;
  focusKey?: string;
  autoFocus?: boolean;
  className?: string;
  type?: "text" | "url" | "search";
  /** Start in edit mode (keyboard goes straight into the input) — for screens whose
   *  whole purpose is typing, like search. */
  editOnMount?: boolean;
}

/** A text input that lives inside spatial navigation: Enter (or click) starts editing and
 *  pauses D-pad navigation; Enter/Escape/Up/Down leave editing and hand control back. */
export function TextField({ value, onChange, onSubmit, placeholder, icon, focusKey, autoFocus, className = "", type = "text", editOnMount }: TextFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);

  const startEdit = () => {
    setEditing(true);
    pause();
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const stopEdit = () => {
    setEditing(false);
    resume();
    inputRef.current?.blur();
  };

  useEffect(() => {
    if (editOnMount) startEdit();
    // Leaving the screen mid-edit must not leave spatial navigation paused app-wide.
    return () => resume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Focusable
      focusKey={focusKey}
      autoFocus={autoFocus}
      className={`field ${editing ? "is-editing" : ""} ${className}`}
      onPress={() => {
        if (!editing) startEdit();
      }}
    >
      {icon}
      <input
        ref={inputRef}
        type={type}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          playCategorySound("typing");
        }}
        onFocus={() => {
          if (!editing) {
            setEditing(true);
            pause();
          }
        }}
        onBlur={() => {
          if (editing) {
            setEditing(false);
            resume();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            stopEdit();
            onSubmit?.(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            stopEdit();
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            stopEdit();
            void navigateByDirection(e.key === "ArrowDown" ? "down" : "up");
          }
        }}
      />
    </Focusable>
  );
}
