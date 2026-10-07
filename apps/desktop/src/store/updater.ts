import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../data/io";

const AUTO_KEY = "kinonyx.autoUpdateCheck";
const LAST_KEY = "kinonyx.lastUpdateCheck";
const DAY_MS = 24 * 60 * 60 * 1000;

export type UpdateStatus = "idle" | "checking" | "uptodate" | "available" | "downloading" | "installing" | "error";

interface UpdaterState {
  status: UpdateStatus;
  update: Update | null;
  /** 0..1 while downloading (0 if the server didn't announce a size). */
  progress: number;
  error: string | null;
  /** "Позже" on the modal — it stays available in Settings, just stops popping up. */
  dismissed: boolean;
  autoCheck: boolean;
  setAutoCheck: (on: boolean) => void;
  /** `manual` = the viewer asked: errors are shown, otherwise a failed check stays silent. */
  check: (manual: boolean) => Promise<void>;
  /** Once a day, if enabled — called at startup. */
  maybeAutoCheck: () => void;
  install: () => Promise<void>;
  dismiss: () => void;
}

function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "0";
  } catch {
    return true;
  }
}

export const useUpdater = create<UpdaterState>((set, get) => ({
  status: "idle",
  update: null,
  progress: 0,
  error: null,
  dismissed: false,
  autoCheck: readAuto(),

  setAutoCheck(on) {
    set({ autoCheck: on });
    try {
      localStorage.setItem(AUTO_KEY, on ? "1" : "0");
    } catch {
      /* preference just won't survive a restart */
    }
  },

  async check(manual) {
    if (!isTauri) {
      if (manual) set({ status: "error", error: "Обновления работают только в установленном приложении." });
      return;
    }
    const { status } = get();
    if (status === "checking" || status === "downloading" || status === "installing") return;
    set({ status: "checking", error: null });
    try {
      const update = await check();
      if (update) set({ status: "available", update, dismissed: false });
      else set({ status: "uptodate", update: null });
    } catch (e) {
      // Typically: no release published yet / the update source isn't configured / offline.
      set({
        status: manual ? "error" : "idle",
        error: manual ? `Не удалось проверить обновления: ${e instanceof Error ? e.message : String(e)}` : null,
      });
    }
  },

  maybeAutoCheck() {
    if (!isTauri || !get().autoCheck) return;
    try {
      const last = Number(localStorage.getItem(LAST_KEY) ?? 0);
      if (Date.now() - last < DAY_MS) return;
      localStorage.setItem(LAST_KEY, String(Date.now()));
    } catch {
      /* no storage: check every start, harmless */
    }
    void get().check(false);
  },

  async install() {
    const { update } = get();
    if (!update) return;
    set({ status: "downloading", progress: 0, error: null });
    try {
      let total = 0;
      let received = 0;
      await update.download((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total > 0) set({ progress: Math.min(1, received / total) });
        } else if (event.event === "Finished") set({ status: "installing", progress: 1 });
      });
      // The installer is our child process and would die with the app (see `prepare_for_update`
      // in lib.rs) — free it first. On Windows `install()` then launches it and exits the app.
      set({ status: "installing" });
      await invoke("prepare_for_update");
      await update.install();
    } catch (e) {
      set({ status: "error", error: `Не удалось установить обновление: ${e instanceof Error ? e.message : String(e)}` });
    }
  },

  dismiss() {
    set({ dismissed: true });
  },
}));
