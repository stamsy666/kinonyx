const KEY = "kinonyx.speedTest";

/** The last measurement of the internet speed: what it was and when. */
export interface SpeedResult {
  mbit: number;
  at: number;
}

export function lastSpeed(): SpeedResult | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const r = JSON.parse(raw) as SpeedResult;
      if (Number.isFinite(r.mbit) && r.mbit > 0) return r;
    }
  } catch {
    /* none yet */
  }
  return null;
}

/** Measures, remembers and returns the speed (megabits per second). */
export async function runSpeedTest(): Promise<SpeedResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  const mbit = await invoke<number>("speedtest_run");
  const result = { mbit, at: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(result));
  } catch {
    /* the result just is not remembered */
  }
  return result;
}

/** What a film needs on top of its average bitrate: a torrent's peers are uneven and the speed measured is the best case. */
const HEADROOM = 0.7;

/** The bitrate (megabits per second) a connection of this speed can reliably carry. */
export const sustainable = (mbit: number): number => mbit * HEADROOM;

export type QualityVerdict = { quality: "4K" | "1080p" | "720p" | "SD"; text: string };

/** The highest picture the speed carries: typical bitrates are ≈ 40 for 4K, 12 for Full HD, 5 for HD. */
export function recommendQuality(mbit: number): QualityVerdict {
  const s = sustainable(mbit);
  if (s >= 40) return { quality: "4K", text: "хватит на 4K" };
  if (s >= 12) return { quality: "1080p", text: "хватит на Full HD" };
  if (s >= 5) return { quality: "720p", text: "хватит на HD" };
  return { quality: "SD", text: "лучше лёгкое качество" };
}
