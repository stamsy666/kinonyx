import { isTauri } from "./io";

/** The phone as a remote control (Rust side: src-tauri/src/remote.rs). Desktop build only. */

export interface RemoteInfo {
  /** Addresses the phone can open, the most likely first. */
  urls: string[];
  /** The first address as a QR code (SVG markup). */
  qr: string;
}

export interface RemoteTextEdit {
  remove: number;
  text: string;
  submit: boolean;
}

declare global {
  interface WindowEventMap {
    "kinonyx:remote-edit": CustomEvent<RemoteTextEdit>;
    "kinonyx:remote-volume": CustomEvent<number>;
  }
}

/** Apply a phone edit at the desktop caret, replacing a selected range when present. */
export function applyRemoteTextEdit(value: string, edit: RemoteTextEdit, start = value.length, end = start) {
  const before = Array.from(value.slice(0, start));
  // The selection is itself the deletion for the first backspace.
  const remove = Math.max(0, edit.remove - Number(end > start));
  const prefix = before.slice(0, Math.max(0, before.length - remove)).join("") + edit.text;
  return { value: prefix + value.slice(end), caret: prefix.length };
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error("Пульт работает только в приложении для ПК");
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export const remoteStart = (token: string) => invoke<RemoteInfo>("remote_start", { token });
export const remoteStop = () => invoke<void>("remote_stop");
export const remoteInfo = () => invoke<RemoteInfo | null>("remote_info");
/** The app's current colours (CSS variables), for the remote page to wear. */
export const remoteTheme = (vars: Record<string, string>) => invoke<void>("remote_theme", { vars });

async function listen<T>(event: string, fn: (payload: T) => void): Promise<() => void> {
  if (!isTauri) return () => undefined;
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  return tauriListen<T>(event, (e) => fn(e.payload));
}
export const onRemoteKey = (fn: (key: string) => void) => listen<string>("remote://key", fn);
export const onRemoteText = (fn: (text: string) => void) => listen<string>("remote://text", fn);
export const onRemoteEdit = (fn: (edit: RemoteTextEdit) => void) => listen<string>("remote://edit", (json) => fn(JSON.parse(json)));
export const onRemoteVolume = (fn: (volume: number, feedback: boolean) => void) =>
  listen<string>("remote://volume", (json) => {
    const { level, feedback } = JSON.parse(json) as { level: number; feedback: boolean };
    fn(level / 100, feedback);
  });
