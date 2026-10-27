import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/roboto/900.css";
import "./styles/theme.css";
import "./styles/tv.css";
import "./styles/beam.css";
import "./styles/schemes.css";
import { initSpatialNavigation, installBackKeyListener, startGamepadBridge } from "@kinonyx/ui";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "./data/io";
import { installLogCapture } from "./data/log";
import { applyStartupWindow } from "./data/windowPrefs";
import { restoreUserData, startUserDataMirror } from "./data/userdata";

async function boot() {
  installLogCapture();
  // The stores read localStorage the moment their modules load: a profile that came up empty gets its data back from the
  // copy first, and only then are the app and the stores imported.
  await restoreUserData();
  startUserDataMirror();
  const { App } = await import("./App");
  const { installDownloadEvents } = await import("./store/downloads");
  void installDownloadEvents();

  initSpatialNavigation();
  installBackKeyListener();
  startGamepadBridge();

  // No browser context menu ("Назад / Обновить / Сохранить как / Печать / Проверить") on a
  // right click — it's an app, not a web page. Text fields keep theirs (copy / paste).
  window.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, [contenteditable='true']")) return;
    e.preventDefault();
    // A right click is "back" (closes a window, leaves a page), like Escape.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  // The window is transparent (mpv draws behind the page) and starts hidden
  // (tauri.conf.json `visible: false`): shown before the page's first paint, it was a
  // see-through frame over the desktop for a moment. Two frames in, the opaque background
  // is on screen. src-tauri/src/lib.rs shows it anyway after a few seconds if this never runs.
  if (isTauri) {
    // The chosen screen / full screen first, then show — otherwise the window would hop in front of the user.
    void applyStartupWindow().finally(() => requestAnimationFrame(() => requestAnimationFrame(() => void getCurrentWindow().show())));
  }
}

void boot();
