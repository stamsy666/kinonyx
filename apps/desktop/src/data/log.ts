import { isTauri } from "./io";

type Level = "info" | "warn" | "error";

/** Writes a line to the app's log file (`%USERPROFILE%\.kinonyx\logs`). A no-op in the browser preview. */
export function logEvent(level: Level, scope: string, message: string): void {
  if (!isTauri) return;
  void import("@tauri-apps/api/core").then(({ invoke }) => invoke("log_write", { level, scope, message }).catch(() => undefined));
}

const text = (v: unknown): string => {
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? `\n${v.stack.split("\n").slice(1, 4).join("\n")}` : ""}`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

/** The page's uncaught errors, rejected promises and console errors/warnings go to the log too. */
export function installLogCapture(): void {
  if (!isTauri) return;
  window.addEventListener("error", (e) => logEvent("error", "page", `${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener("unhandledrejection", (e) => logEvent("error", "page", `unhandled rejection: ${text(e.reason)}`));
  // Identical console messages repeat a lot (a render loop would write thousands) — at most 3 per message.
  const seen = new Map<string, number>();
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      const msg = args.map(text).join(" ").slice(0, 1500);
      const n = (seen.get(msg) ?? 0) + 1;
      seen.set(msg, n);
      if (n <= 3) logEvent(level, "console", msg);
    };
  }
}

export async function logTail(lines = 200): Promise<string> {
  if (!isTauri) return "";
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("log_tail", { lines });
}

export async function openLogDir(): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("log_open_dir");
}
