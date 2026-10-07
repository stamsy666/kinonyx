import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./io";
import { useApp } from "../store/app";

/** Discord status ("Watching KINONYX"). Every call is fire-and-forget: Discord not running,
 *  no application id, or running in the browser preview just means nothing happens. */
let lastKey = "";

export interface Presence {
  /** First line — what is being watched. */
  details: string;
  /** Second line. */
  state?: string;
  /** Unix seconds the viewing began; makes Discord show an elapsed timer. Omit while paused. */
  startedAt?: number;
}

export function setPresence(p: Presence) {
  if (!isTauri || !useApp.getState().discordEnabled) return;
  // The timer start moves every call; the text part decides whether anything changed.
  const key = `${p.details}|${p.state ?? ""}|${p.startedAt ? "t" : "-"}`;
  if (key === lastKey) return;
  lastKey = key;
  void invoke("discord_set", { details: p.details, state: p.state ?? null, startedAt: p.startedAt ?? null }).catch(() => undefined);
}

export function clearPresence() {
  if (!isTauri) return;
  lastKey = "";
  void invoke("discord_clear").catch(() => undefined);
}
