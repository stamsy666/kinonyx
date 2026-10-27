import { availableMonitors, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { isTauri } from "./io";

const START_FULLSCREEN_KEY = "kinonyx.startFullscreen";
const MONITOR_KEY = "kinonyx.monitor";

export interface MonitorChoice {
  /** The monitor's name from the system; "" = wherever the window opens. */
  value: string;
  label: string;
}

export function readStartFullscreen(): boolean {
  try {
    return localStorage.getItem(START_FULLSCREEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeStartFullscreen(on: boolean): void {
  try {
    localStorage.setItem(START_FULLSCREEN_KEY, on ? "1" : "0");
  } catch {
    /* won't survive a restart */
  }
}

export function readMonitor(): string {
  try {
    return localStorage.getItem(MONITOR_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeMonitor(name: string): void {
  try {
    localStorage.setItem(MONITOR_KEY, name);
  } catch {
    /* won't survive a restart */
  }
}

/** The screens the system reports, for the choice in Settings. Names repeat for identical monitors — numbered then. */
export async function listMonitors(): Promise<MonitorChoice[]> {
  const choices: MonitorChoice[] = [{ value: "", label: "Где откроется" }];
  if (!isTauri) return choices;
  const monitors = await availableMonitors();
  monitors.forEach((m, i) => {
    const name = m.name ?? `Монитор ${i + 1}`;
    choices.push({ value: name, label: `${i + 1} · ${name} (${m.size.width}×${m.size.height})` });
  });
  return choices;
}

/** Puts the window on the chosen monitor (keeping it full screen if it is). Returns false if that monitor is gone. */
export async function moveToMonitor(name: string): Promise<boolean> {
  if (!isTauri || !name) return true;
  const target = (await availableMonitors()).find((m) => m.name === name);
  if (!target) return false;
  const win = getCurrentWindow();
  const wasFull = await win.isFullscreen();
  if (wasFull) await win.setFullscreen(false);
  const wasMax = await win.isMaximized();
  if (wasMax) await win.unmaximize();
  // A little inside the corner: the title bar must be reachable if the window isn't maximised.
  await win.setPosition(new PhysicalPosition(target.position.x + 60, target.position.y + 60));
  if (wasMax) await win.maximize();
  if (wasFull) await win.setFullscreen(true);
  return true;
}

/** Called once at launch, before the window is shown: the chosen screen, then full screen if asked. */
export async function applyStartupWindow(): Promise<void> {
  if (!isTauri) return;
  try {
    await moveToMonitor(readMonitor());
    if (readStartFullscreen()) await getCurrentWindow().setFullscreen(true);
  } catch (e) {
    console.warn("[window] startup placement failed", e);
  }
}
