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
import { App } from "./App";
import { isTauri } from "./data/io";

initSpatialNavigation();
installBackKeyListener();
startGamepadBridge();

// No browser context menu ("Назад / Обновить / Сохранить как / Печать / Проверить") on a
// right click — it's an app, not a web page. Text fields keep theirs (copy / paste).
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement | null;
  if (t?.closest("input, textarea, [contenteditable='true']")) return;
  e.preventDefault();
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
if (isTauri) requestAnimationFrame(() => requestAnimationFrame(() => void getCurrentWindow().show()));
