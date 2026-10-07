import { decodeBody } from "@kinonyx/epg";
import { isTauri } from "./io";

async function invokeBytes(cmd: string, args: Record<string, unknown>): Promise<Uint8Array> {
  const { invoke } = await import("@tauri-apps/api/core");
  const buf = await invoke<ArrayBuffer>(cmd, args);
  return new Uint8Array(buf);
}

/** Playlist/guide text. In the app the download goes through Rust (shared pooled client,
 *  no webview CORS); the browser preview falls back to plain fetch. */
export async function fetchText(url: string, timeoutMs = 30_000): Promise<string> {
  if (isTauri) return decodeBody(await invokeBytes("fetch_bytes", { url }));
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return decodeBody(new Uint8Array(await res.arrayBuffer()));
}

export async function pickPlaylistFile(): Promise<{ path: string; text: string } | null> {
  if (!isTauri) throw new Error("Выбор файла доступен только в десктопном приложении");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({
    multiple: false,
    directory: false,
    title: "Выберите плейлист",
    filters: [{ name: "Плейлисты", extensions: ["m3u", "m3u8", "txt"] }],
  });
  if (!path) return null;
  return { path, text: await readLocalFile(path) };
}

export async function readLocalFile(path: string): Promise<string> {
  return decodeBody(await invokeBytes("read_playlist_file", { path }));
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
