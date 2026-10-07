import { openUrl } from "@tauri-apps/plugin-opener";

export const isTauri = "__TAURI_INTERNALS__" in window;

export async function openExternal(url: string): Promise<void> {
  if (isTauri) await openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
