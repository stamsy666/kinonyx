import { isTauri } from "./io";
import { logEvent } from "./log";

/** Everything the viewer builds up lives in localStorage under this prefix: favourites, what they are watching, progress,
 *  statistics, playlists, settings. A copy is kept outside the WebView's profile (Rust `userdata.rs`) and comes back if
 *  the profile is ever lost to an update, a reinstall or a "cleaner". */
const PREFIX = "kinonyx.";

interface Snapshot {
  version: 1;
  savedAt: number;
  keys: Record<string, string>;
}

function collect(): Snapshot {
  const keys: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys[k] = localStorage.getItem(k) ?? "";
    }
  } catch {
    /* an unreadable storage gives an empty snapshot, which is never saved */
  }
  return { version: 1, savedAt: Date.now(), keys };
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function parse(text: string): Snapshot | null {
  try {
    const data = JSON.parse(text) as Partial<Snapshot>;
    if (!data || typeof data.keys !== "object" || data.keys === null) return null;
    const keys: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.keys)) if (k.startsWith(PREFIX) && typeof v === "string") keys[k] = v;
    return { version: 1, savedAt: Number(data.savedAt) || 0, keys };
  } catch {
    return null;
  }
}

function userKeyCount(): number {
  return Object.keys(collect().keys).length;
}

/** At launch, BEFORE anything reads the storage: a profile that came up empty gets its data back from the copy. */
export async function restoreUserData(): Promise<void> {
  if (!isTauri) return;
  try {
    if (userKeyCount() > 0) return;
    const text = await call<string | null>("userdata_load");
    const snap = text ? parse(text) : null;
    if (!snap || Object.keys(snap.keys).length === 0) return;
    for (const [k, v] of Object.entries(snap.keys)) localStorage.setItem(k, v);
    logEvent("warn", "userdata", `the profile was empty — restored ${Object.keys(snap.keys).length} keys from the copy`);
  } catch (e) {
    console.warn("[userdata] restore failed", e);
  }
}

let lastSaved = "";
let timer = 0;

async function save(): Promise<void> {
  const snap = collect();
  // A storage that came up empty must not replace a good copy.
  if (Object.keys(snap.keys).length === 0) return;
  const body = JSON.stringify({ ...snap, savedAt: 0 });
  if (body === lastSaved) return;
  try {
    await call("userdata_save", { json: JSON.stringify(snap) });
    lastSaved = body;
  } catch (e) {
    logEvent("error", "userdata", `saving the copy failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Keeps the copy up to date: a few seconds after the last change, and when the window goes away. */
export function startUserDataMirror(): void {
  if (!isTauri) return;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void save(), 4000);
  };
  const proto = Storage.prototype;
  const setItem = proto.setItem;
  const removeItem = proto.removeItem;
  proto.setItem = function (key: string, value: string) {
    setItem.call(this, key, value);
    if (this === localStorage && key.startsWith(PREFIX)) schedule();
  };
  proto.removeItem = function (key: string) {
    removeItem.call(this, key);
    if (this === localStorage && key.startsWith(PREFIX)) schedule();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void save();
  });
  window.addEventListener("pagehide", () => void save());
  // The first copy of a viewer who had data before this existed.
  schedule();
}

/** Settings → О программе → «Сохранить данные в файл». */
export async function exportUserData(): Promise<"saved" | "cancelled"> {
  const { save: pick } = await import("@tauri-apps/plugin-dialog");
  const path = await pick({
    title: "Сохранить данные KINONYX",
    defaultPath: `KINONYX-данные-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "Данные KINONYX", extensions: ["json"] }],
  });
  if (!path) return "cancelled";
  await call("userdata_export", { path, json: JSON.stringify(collect(), null, 2) });
  return "saved";
}

/** Settings → О программе → «Загрузить данные из файла»: replaces what is there with the file's data and restarts the page. */
export async function importUserData(): Promise<"loaded" | "cancelled"> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({
    title: "Загрузить данные KINONYX",
    multiple: false,
    directory: false,
    filters: [{ name: "Данные KINONYX", extensions: ["json"] }],
  });
  if (typeof path !== "string") return "cancelled";
  const text = await call<string>("userdata_import", { path });
  const snap = parse(text);
  if (!snap || Object.keys(snap.keys).length === 0) throw new Error("В файле нет данных KINONYX");
  // What is here is replaced by the file's (not mixed with it): the keys the file doesn't have go away.
  for (const k of Object.keys(collect().keys)) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(snap.keys)) localStorage.setItem(k, v);
  await save();
  window.location.reload();
  return "loaded";
}

export async function openUserDataDir(): Promise<void> {
  if (isTauri) await call("userdata_open_dir");
}
