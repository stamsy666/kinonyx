import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "./io";

export async function isFullscreen(): Promise<boolean> {
  if (isTauri) return getCurrentWindow().isFullscreen();
  return document.fullscreenElement != null;
}

export async function setFullscreen(on: boolean): Promise<void> {
  if (isTauri) {
    await getCurrentWindow().setFullscreen(on);
    return;
  }
  if (on) await document.documentElement.requestFullscreen();
  else if (document.fullscreenElement) await document.exitFullscreen();
}
