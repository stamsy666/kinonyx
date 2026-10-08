import { isTauri } from "./io";

/**
 * Picture-in-picture at the OS level: the whole program window shrinks to a small borderless
 * always-on-top window in the screen's bottom-right corner (it stays over every other program),
 * and grows back to what it was on expand. mpv's surface follows the window, so the picture
 * simply gets smaller with it.
 */
export const PIP_W = 440;
export const PIP_H = 248;
const MARGIN = 20;

interface Saved {
  fullscreen: boolean;
  maximized: boolean;
  pos: { x: number; y: number };
  size: { width: number; height: number };
}

let saved: Saved | null = null;

export async function enterPip() {
  if (!isTauri || saved) return;
  try {
    const { getCurrentWindow, currentMonitor, LogicalSize, PhysicalPosition } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    const [fullscreen, maximized, pos, size, monitor] = await Promise.all([
      w.isFullscreen(),
      w.isMaximized(),
      w.outerPosition(),
      w.outerSize(),
      currentMonitor(),
    ]);
    saved = { fullscreen, maximized, pos: { x: pos.x, y: pos.y }, size: { width: size.width, height: size.height } };
    if (fullscreen) await w.setFullscreen(false);
    if (maximized) await w.unmaximize();
    await w.setMinSize(null);
    await w.setDecorations(false);
    await w.setAlwaysOnTop(true);
    await w.setSize(new LogicalSize(PIP_W, PIP_H));
    if (monitor) {
      const k = monitor.scaleFactor;
      const area = monitor.workArea ?? { position: monitor.position, size: monitor.size };
      const x = area.position.x + area.size.width - Math.round((PIP_W + MARGIN) * k);
      const y = area.position.y + area.size.height - Math.round((PIP_H + MARGIN) * k);
      await w.setPosition(new PhysicalPosition(x, y));
    }
  } catch (e) {
    console.warn("pip enter failed", e);
  }
}

export async function exitPip() {
  if (!isTauri || !saved) return;
  const s = saved;
  saved = null;
  try {
    const { getCurrentWindow, LogicalSize, PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    await w.setAlwaysOnTop(false);
    await w.setDecorations(true);
    await w.setMinSize(new LogicalSize(960, 600));
    await w.setSize(new PhysicalSize(s.size.width, s.size.height));
    await w.setPosition(new PhysicalPosition(s.pos.x, s.pos.y));
    if (s.maximized) await w.maximize();
    if (s.fullscreen) await w.setFullscreen(true);
    await w.setFocus();
  } catch (e) {
    console.warn("pip exit failed", e);
  }
}
