import type { PlayerState } from "@kinonyx/player-core";

const keyFor = (videoId: string) => `kinonyx.youtubeProgress.${videoId}`;
const SAVE_INTERVAL_MS = 5_000;

export function youtubeResumePosition(videoId: string): number {
  try {
    const position = Number(localStorage.getItem(keyFor(videoId)));
    if (Number.isFinite(position) && position > 0) return position;
  } catch {
    // Playback still works with storage disabled.
  }
  return 0;
}

export function trackYoutubeProgress(videoId: string) {
  const key = keyFor(videoId);
  let saved = youtubeResumePosition(videoId);
  let position = saved;
  let lastSavedAt = Date.now();
  let hasStarted = false;

  const flush = () => {
    if (saved === position) return;
    try {
      if (position > 0) localStorage.setItem(key, String(position));
      else localStorage.removeItem(key);
      saved = position;
    } catch {
      // A later checkpoint can retry if storage becomes available.
    }
    lastSavedAt = Date.now();
  };

  return {
    update(state: PlayerState) {
      if (state.live) return;
      if (state.status === "loading") {
        hasStarted = false;
        return;
      }
      if (state.status === "ended") {
        position = 0;
        flush();
        return;
      }
      if (state.status !== "playing" && state.status !== "paused") return;
      if (!Number.isFinite(state.duration) || state.duration <= 0 || !Number.isFinite(state.position)) return;
      // A new source may briefly report zero before its resume seek takes effect.
      if (!hasStarted && state.position <= 0) return;
      hasStarted = true;
      position = Math.round(Math.max(0, Math.min(state.position, state.duration)));
      if (state.status === "paused" || Date.now() - lastSavedAt >= SAVE_INTERVAL_MS) flush();
    },
    flush,
  };
}
