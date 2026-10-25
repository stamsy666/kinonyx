import { useEffect } from "react";
import { dispatchKey } from "@kinonyx/ui";
import { onRemoteKey, onRemoteText, remoteTheme } from "../data/remote";
import { useRemote } from "../store/remote";

/** The variables the remote page wears: the app's palette and shape. */
const THEME_VARS = [
  "--bg", "--bg-2", "--surface", "--surface-hi", "--line", "--line-hi", "--text", "--text-dim",
  "--accent", "--accent-deep", "--on-accent", "--radius", "--radius-sm", "--logo-filter",
  // The volume of the player on the screen (0..1): the remote draws it between its "+" and "−".
  "--player-volume",
];

/**
 * Turns what the phone presses into what the gamepad would: the same key events. Text typed on
 * the phone goes into the field that has the focus (the search box). Brings the remote back up at
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
    void useRemote.getState().resume();
    let alive = true;
    const offs: (() => void)[] = [];
    void onRemoteKey((key) => dispatchKey(key)).then((f) => (alive ? offs.push(f) : f()));
    void onRemoteText((text) => {
      const el = document.activeElement;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
      // The framework tracks the value through the element's own setter: go around its override.
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }).then((f) => (alive ? offs.push(f) : f()));
    return () => {
      alive = false;
      offs.forEach((f) => f());
    };
  }, []);
  return null;
}
