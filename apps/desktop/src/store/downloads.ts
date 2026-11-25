import { create } from "zustand";
import { Channel, invoke } from "@tauri-apps/api/core";
import { isTauri } from "../data/io";
import { logEvent } from "../data/log";
import { useNotices } from "./notifications";
import { openTorrent, streamUrlFor } from "../data/api";

const KEY = "kinonyx.downloads";
const DIR_KEY = "kinonyx.downloadDir";

export type DownloadStatus = "preparing" | "downloading" | "paused" | "done" | "error";

interface DownloadFields {
  id: string;
  title: string;
  poster?: string;
  fileName: string;
  total: number;
  received: number;
  speed: number;
  status: DownloadStatus;
  error?: string;
  /** Where the finished file is. */
  path?: string;
  addedAt: number;
}

interface TorrentDownload extends DownloadFields {
  source?: "torrent";
  filmId: number;
  film?: { nameRu?: string; nameOriginal?: string; year?: string | number; genres?: string[] };
  link: string;
  fileId: number;
  filePath: string;
  dir: string;
}

type YoutubeStage = "started" | "video" | "audio" | "file" | "merging";
interface YoutubeDownload extends DownloadFields {
  source: "youtube";
  videoId: string;
  quality?: number;
  stage?: YoutubeStage;
}

export type DownloadItem = TorrentDownload | YoutubeDownload;
type DownloadPatch = Partial<DownloadFields & Pick<YoutubeDownload, "quality" | "stage">>;
type YoutubeDownloadInput = Pick<YoutubeDownload, "videoId" | "title" | "poster" | "quality">;

interface YoutubeProgress {
  stage: YoutubeStage;
  fileName: string | null;
  received: number;
  total: number;
  speed: number;
}

interface SavedYoutubeVideo {
  fileName: string;
  path: string;
  height: number | null;
  bytes: number;
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
function save(items: DownloadItem[], immediate = false) {
  window.clearTimeout(saveTimer);
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* the list won't survive a restart */
    }
  };
  if (immediate) persist();
  else saveTimer = window.setTimeout(persist, 1500);
}

interface DownloadsState {
  items: DownloadItem[];
  patch: (id: string, patch: DownloadPatch) => void;
  add: (item: DownloadItem) => void;
  drop: (id: string) => void;
}

export const useDownloads = create<DownloadsState>((set, get) => ({
  items: read(),
  patch(id, patch) {
    const current = get().items;
    const original = current.find((d) => d.id === id);
    if (!original) return;
    const items = current.map((d) => (d.id === id ? { ...d, ...patch } : d));
    set({ items });
    save(items, patch.status !== undefined && patch.status !== original.status);
  },
  add(item) {
    const items = [item, ...get().items.filter((d) => d.id !== item.id)];
    set({ items });
    save(items, true);
  },
  drop(id) {
    const items = get().items.filter((d) => d.id !== id);
    set({ items });
    save(items, true);
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
export async function enqueueDownload(input: Pick<TorrentDownload, "filmId" | "title" | "poster" | "film" | "link" | "fileId" | "filePath" | "dir">): Promise<void> {
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

export function enqueueYoutubeDownload(input: YoutubeDownloadInput) {
  return runYoutubeDownload(`youtube:${crypto.randomUUID()}`, input);
}

const pendingYoutubeDownloads = new Set<string>();

async function runYoutubeDownload(id: string, input: YoutubeDownloadInput): Promise<SavedYoutubeVideo | null> {
  if (pendingYoutubeDownloads.has(id)) return null;
  pendingYoutubeDownloads.add(id);
  const { add, patch, drop } = useDownloads.getState();
  let started = false;
  let finished = false;
  const item: YoutubeDownload = { ...input, id, source: "youtube", status: "preparing",
    fileName: "", received: 0, total: 0, speed: 0, addedAt: Date.now() };
  const progress = new Channel<YoutubeProgress>((event) => {
    if (finished) return;
    if (event.stage === "started") {
      started = true;
      add({ ...item, stage: event.stage, fileName: event.fileName ?? "" });
    } else if (started) {
      const { stage, received, total, speed } = event;
      patch(id, { stage, received, total, speed, status: "downloading" });
    }
  });
  try {
    const saved = await invoke<SavedYoutubeVideo | null>("youtube_download", {
      taskId: id, id: input.videoId, title: input.title, height: input.quality, progress,
    });
    if (!saved) {
      if (started) drop(id);
      return null;
    }
    if (!started) add(item);
    if (!useDownloads.getState().items.some((item) => item.id === id)) return saved;
    patch(id, { status: "done", path: saved.path, quality: saved.height ?? input.quality,
      fileName: saved.fileName, received: saved.bytes, total: saved.bytes, speed: 0 });
    useNotices.getState().add({ id: `dl:${id}`, kind: "download", title: input.title,
      text: "Видео YouTube сохранено", goto: "downloads" });
    return saved;
  } catch (error) {
    if (started) patch(id, { status: "error", error: error instanceof Error ? error.message : String(error), speed: 0 });
    throw error;
  } finally {
    finished = true;
    pendingYoutubeDownloads.delete(id);
  }
}

/** (Re)connects to the torrent and starts or continues the copy — the `.part` file decides where it picks up. */
export async function startTransfer(id: string): Promise<void> {
  const item = useDownloads.getState().items.find((d) => d.id === id);
  if (!item || !isTauri) return;
  const { patch } = useDownloads.getState();
  if (item.source === "youtube") {
    try {
      await runYoutubeDownload(id, item);
    } catch (error) {
      patch(id, { status: "error", error: error instanceof Error ? error.message : String(error), speed: 0 });
    }
    return;
  }
  patch(id, { status: "preparing", error: undefined, speed: 0 });
  try {
    const torrent = await openTorrent(item.link);
    const file = torrent.files.find((f) => f.id === item.fileId) ?? torrent.files.find((f) => f.path === item.filePath);
    if (!file) throw new Error("Файл не найден в раздаче");
    const url = await streamUrlFor(torrent.hash, file);
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
  await invoke("dl_stop", { id });
  useDownloads.getState().patch(id, { status: "paused", speed: 0 });
}

/** Removes it from the list; the unfinished `.part` goes too, the finished file only when `deleteFile`. */
export async function removeDownload(id: string, deleteFile: boolean): Promise<void> {
  const item = useDownloads.getState().items.find((d) => d.id === id);
  if (!item) return;
  if (isTauri) {
    if (item.source === "youtube") {
      await invoke("youtube_cancel_download", { taskId: id });
    } else {
      await invoke("dl_stop", { id }).catch(() => undefined);
      await invoke("dl_remove", { dir: item.dir, fileName: item.fileName, finishedPath: deleteFile ? item.path ?? null : null }).catch(() => undefined);
    }
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
