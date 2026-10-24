import { useEffect } from "react";
import { dispatchKey } from "@kinonyx/ui";
import { onRemoteKey, onRemoteText } from "../data/remote";
import { useRemote } from "../store/remote";

/**
 * Turns what the phone presses into what the gamepad would: the same key events. Text typed on
 * the phone goes into the field that has the focus (the search box). Brings the remote back up at
 * startup when it was left on.
 */
export function RemoteBridge() {
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
