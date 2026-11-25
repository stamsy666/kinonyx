import { useEffect } from "react";
import { dispatchKey, emitPressSound } from "@kinonyx/ui";
import { getCurrentFocusKey } from "@noriginmedia/norigin-spatial-navigation";
import { applyRemoteTextEdit, onRemoteEdit, onRemoteKey, onRemoteText, onRemoteVolume, remoteTheme } from "../data/remote";
import { withRemoteKeySound } from "../data/sounds";
import { useRemote } from "../store/remote";

/** The variables the remote page wears: the app's palette and shape. */
const THEME_VARS = [
  "--bg", "--bg-2", "--surface", "--surface-hi", "--line", "--line-hi", "--text", "--text-dim",
  "--accent", "--accent-deep", "--on-accent", "--radius", "--radius-sm", "--logo-filter",
  // The volume of the player on the screen (0..1): the remote draws it between its "+" and "−".
  "--player-volume",
];

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email", "password", "number"]);

function isEditableField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  return (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type)))
    && !el.readOnly && !el.matches(":disabled");
}

function writeField(el: HTMLInputElement | HTMLTextAreaElement, value: string, caret?: number) {
  if (el.value === value) return;
  // Bypass React's instance setter so the bubbling input event is detected as a change.
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  if (caret !== undefined && el.selectionStart !== null) el.setSelectionRange(caret, caret);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Turns what the phone presses into what the gamepad would: the same key events. Text typed on
 * the phone goes into the selected text field. Brings the remote back up at
 * startup when it was left on.
 */
export function RemoteBridge() {
  // The remote page follows the theme chosen in the app: its colours are sent while the remote runs and
  // again whenever the root element's theme attributes change.
  const running = useRemote((s) => s.info !== null);
  useEffect(() => {
    if (!running) return;
    let timer = 0;
    let last = "";
    const push = () => {
      const cs = getComputedStyle(document.documentElement);
      const vars: Record<string, string> = {};
      for (const name of THEME_VARS) {
        const v = cs.getPropertyValue(name).trim();
        if (v) vars[name] = v;
      }
      const json = JSON.stringify(vars);
      if (json === last) return;
      last = json;
      void remoteTheme(vars).catch(() => undefined);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(push, 250);
    };
    push();
    const watch = new MutationObserver(schedule);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-bg", "data-scheme", "class"] });
    return () => {
      watch.disconnect();
      window.clearTimeout(timer);
    };
  }, [running]);

  useEffect(() => {
    let alive = true;
    const offs: (() => void)[] = [];
    const register = (f: () => void) => { if (alive) offs.push(f); else f(); };
    void Promise.all([
      onRemoteKey((key) => {
        if (key === "RemoteKeyboard") emitPressSound();
        else withRemoteKeySound(key, () => dispatchKey(key));
      }).then(register),
      onRemoteText((text) => {
        const el = document.activeElement;
        if (isEditableField(el)) writeField(el, text);
      }).then(register),
      onRemoteEdit((edit) => {
        const active = document.activeElement;
        const key = getCurrentFocusKey();
        const selected = key ? document.querySelector(`[data-fk="${CSS.escape(key)}"]`) : null;
        const field = isEditableField(active) ? active : selected?.querySelector("input, textarea") ?? null;
        if (!isEditableField(field)) {
          const deliver = () => window.dispatchEvent(new CustomEvent("kinonyx:remote-edit", { detail: edit }));
          if (edit.submit) withRemoteKeySound("Enter", deliver);
          else deliver();
          return;
        }
        if (field !== active) {
          field.focus({ preventScroll: true });
          if (document.activeElement !== field) return;
        }
        if (edit.submit) {
          withRemoteKeySound("Enter", () => dispatchKey("Enter"));
        } else {
          const start = field.selectionStart ?? field.value.length;
          const next = applyRemoteTextEdit(field.value, edit, start, field.selectionEnd ?? start);
          writeField(field, next.value, next.caret);
        }
      }).then(register),
      onRemoteVolume((volume, feedback) => {
        if (feedback) emitPressSound();
        window.dispatchEvent(new CustomEvent("kinonyx:remote-volume", { detail: volume }));
      }).then(register),
    ]).then(() => {
      if (alive) void useRemote.getState().resume();
    });
    return () => {
      alive = false;
      offs.forEach((f) => f());
    };
  }, []);
  return null;
}
