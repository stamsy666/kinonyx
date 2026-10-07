import { invoke } from "@tauri-apps/api/core";
import type { EpgChannel, EpgData, Programme } from "@kinonyx/epg";
import type { EpgWorkerRequest, EpgWorkerResponse } from "./epg.worker";

interface NativeEpgPayload {
  channels: { id: string; names: string[] }[];
  programmes: Record<string, { start: number[]; stop: number[]; title: string[] }>;
}

/**
 * Desktop path: the guide is downloaded (gzip) and parsed in Rust, and only a compact
 * columnar payload crosses the IPC boundary — see src-tauri/src/epg.rs for why. Only
 * programmes overlapping [minStop, maxStart] are returned.
 *
 * `maxAgeMs` lets Rust serve the parsed payload straight from its on-disk cache instead
 * of re-downloading and re-parsing — the cache (unlike the in-memory `epg`/`epgIndex` in
 * store/tv.ts) survives an app restart, which is what "Обновление программы передач"
 * (day/week) is actually supposed to mean. Pass 0 to force a real fetch.
 */
export async function fetchEpgNative(url: string, minStopMs: number, maxStartMs: number, maxAgeMs = 0): Promise<EpgData> {
  const payload = await invoke<NativeEpgPayload>("fetch_epg", { url, minStopMs, maxStartMs, maxAgeMs });
  const channels = new Map<string, EpgChannel>();
  for (const c of payload.channels) channels.set(c.id, { id: c.id, displayNames: c.names });
  const programmes = new Map<string, Programme[]>();
  for (const [channelId, cols] of Object.entries(payload.programmes)) {
    const list: Programme[] = new Array(cols.start.length);
    for (let i = 0; i < cols.start.length; i++) {
      list[i] = { channelId, start: cols.start[i], stop: cols.stop[i], title: cols.title[i] };
    }
    programmes.set(channelId, list);
  }
  return { channels, programmes };
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (d: EpgData) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./epg.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<EpgWorkerResponse>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.data) p.resolve(e.data.data);
    else p.reject(new Error(e.data.error ?? "EPG parse failed"));
  };
  return worker;
}

/** Parses XMLTV off the main thread so multi-megabyte guides never freeze the UI. */
export function parseEpgInWorker(xml: string): Promise<EpgData> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: EpgWorkerRequest = { id, xml };
    getWorker().postMessage(req);
  });
}

export function mergeEpg(target: EpgData, source: EpgData): EpgData {
  for (const [id, ch] of source.channels) if (!target.channels.has(id)) target.channels.set(id, ch);
  for (const [id, list] of source.programmes) {
    const existing = target.programmes.get(id);
    if (!existing) target.programmes.set(id, list);
    else {
      existing.push(...list);
      existing.sort((a, b) => a.start - b.start);
    }
  }
  return target;
}
