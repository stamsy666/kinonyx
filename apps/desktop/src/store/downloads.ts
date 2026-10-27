import { create } from "zustand";
import { isTauri } from "../data/io";
import { logEvent } from "../data/log";
import { useNotices } from "./notifications";
import { openTorrent, streamUrlFor } from "../data/api";

const KEY = "kinonyx.downloads";
const DIR_KEY = "kinonyx.downloadDir";

export type DownloadStatus = "preparing" | "downloading" | "paused" | "done" | "error";

/** A film or episode being saved to disk (the transfer itself is Rust's `download.rs`). */
export interface DownloadItem {
  id: string;
  filmId: number;
  /** What the list shows: the film's name (and the episode's file for a series). */
  title: string;
  poster?: string;
  film?: { nameRu?: string; nameOriginal?: string; year?: string | number; genres?: string[] };
  /** What the torrent is opened by, and which of its files — so a paused or restarted download can reconnect. */
  link: string;
  fileId: number;
  filePath: string;
  fileName: string;
  dir: string;
  total: number;
  received: number;
  speed: number;
  status: DownloadStatus;
  error?: string;
  /** Where the finished file is. */
  path?: string;
  addedAt: number;
}

function read(): DownloadItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      // A download that was running when the app closed is not running now.
      return (JSON.parse(raw) as DownloadItem[]).map((d) => (d.status === "downloading" || d.status === "preparing" ? { ...d, status: "paused" as const, speed: 0 } : d));
    }
  } catch {
    /* falls through to empty */
  }
  return [];
}

let saveTimer = 0;
function save(items: DownloadItem[]) {
  window.clearTimeout(saveTimer);
  // Progress arrives twice a second — the disk gets it every few seconds, and at once on anything that isn't progress.
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* the list won't survive a restart */
    }
  }, 1500);
}

interface DownloadsState {
  items: DownloadItem[];
  patch: (id: string, patch: Partial<DownloadItem>) => void;
  add: (item: DownloadItem) => void;
  drop: (id: string) => void;
}

export const useDownloads = create<DownloadsState>((set, get) => ({
  items: read(),
  patch(id, patch) {
    const items = get().items.map((d) => (d.id === id ? { ...d, ...patch } : d));
    set({ items });
    save(items);
  },
  add(item) {
    const items = [item, ...get().items.filter((d) => d.id !== item.id)];
    set({ items });
    save(items);
  },
  drop(id) {
    const items = get().items.filter((d) => d.id !== id);
    set({ items });
    save(items);
  },
}));

export function lastDownloadDir(): string {
  try {
    return localStorage.getItem(DIR_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The system's folder picker, opened where the last download went. Null if cancelled. */
export async function pickDownloadDir(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const chosen = await open({ directory: true, multiple: false, title: "Куда сохранить фильм", defaultPath: lastDownloadDir() || undefined });
  if (typeof chosen !== "string") return null;
  try {
    localStorage.setItem(DIR_KEY, chosen);
  } catch {
    /* the next time asks from the default place */
  }
  return chosen;
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Adds a download to the list and starts it. */
export async function enqueueDownload(input: Pick<DownloadItem, "filmId" | "title" | "poster" | "film" | "link" | "fileId" | "filePath" | "dir">): Promise<void> {
  const id = `${input.filmId}:${input.fileId}:${Date.now().toString(36)}`;
  useDownloads.getState().add({
    ...input,
    id,
    fileName: baseName(input.filePath),
    total: 0,
    received: 0,
    speed: 0,
    status: "preparing",
    addedAt: Date.now(),
  });
  await startTransfer(id);
}

/** (Re)connects to the torrent and starts or continues the copy — the `.part` file decides where it picks up. */
export async function startTransfer(id: string): Promise<void> {
  const item = useDownloads.getState().items.find((d) => d.id === id);
  if (!item || !isTauri) return;
  const { patch } = useDownloads.getState();
  patch(id, { status: "preparing", error: undefined, speed: 0 });
  try {
    const torrent = await openTorrent(item.link);
    const file = torrent.files.find((f) => f.id === item.fileId) ?? torrent.files.find((f) => f.path === item.filePath);
    if (!file) throw new Error("Файл не найден в раздаче");
    const url = await streamUrlFor(torrent.hash, file);
    const { invoke } = await import("@tauri-apps/api/core");
    patch(id, { status: "downloading", total: file.length });
    await invoke("dl_start", { id, url, dir: item.dir, fileName: item.fileName });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logEvent("error", "download", `${item.title}: ${message}`);
    patch(id, { status: "error", error: message });
  }
}

export async function pauseTransfer(id: string): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("dl_stop", { id });
  useDownloads.getState().patch(id, { status: "paused", speed: 0 });
}

/** Removes it from the list; the unfinished `.part` goes too, the finished file only when `deleteFile`. */
export async function removeDownload(id: string, deleteFile: boolean): Promise<void> {
  const item = useDownloads.getState().items.find((d) => d.id === id);
  if (!item) return;
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("dl_stop", { id }).catch(() => undefined);
    await invoke("dl_remove", { dir: item.dir, fileName: item.fileName, finishedPath: deleteFile ? item.path ?? null : null }).catch(() => undefined);
  }
  useDownloads.getState().drop(id);
}

/** Listens to the Rust side once, at launch. */
export async function installDownloadEvents(): Promise<void> {
  if (!isTauri) return;
  const { listen } = await import("@tauri-apps/api/event");
  const { patch } = useDownloads.getState();
  await listen<{ id: string; received: number; total: number; speed: number }>("download://progress", (e) =>
    patch(e.payload.id, { received: e.payload.received, total: e.payload.total, speed: e.payload.speed }),
  );
  await listen<{ id: string; path: string }>("download://done", (e) => {
    patch(e.payload.id, { status: "done", path: e.payload.path, speed: 0 });
    const item = useDownloads.getState().items.find((d) => d.id === e.payload.id);
    useNotices.getState().add({ id: `dl:${e.payload.id}`, kind: "download", title: item?.title ?? "Загрузка", text: "Загрузка завершена, фильм можно смотреть без интернета", poster: item?.poster, goto: "downloads" });
  });
  await listen<{ id: string; message: string }>("download://error", (e) => patch(e.payload.id, { status: "error", error: e.payload.message, speed: 0 }));
}
