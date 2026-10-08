import { useEffect, useState } from "react";
import type { PlayerStatus } from "@kinonyx/player-core";
import { isTauri } from "../data/io";

// "playing" comes from mpv's core-idle flipping, a hair before the first frame is actually
// composited — a short grace keeps even that sliver of desktop from flashing through.
const REVEAL_DELAY_MS = 150;

/**
 * mpv draws into a native surface *behind* the (transparent) window, seen through a
 * transparent hole in the page. Until mpv has a frame to show, that surface shows nothing —
 * so a page made transparent right away (the old behaviour) showed the user's desktop
 * through the window while a channel/film was still connecting. The page stays opaque
 * black (`.player--mpv` without `.player--revealed`) until playback has actually started,
 * and goes opaque again whenever the source changes or playback stops.
 */
export function useMpvReveal(status: PlayerStatus, source: unknown, mini = false): boolean {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => setRevealed(false), [source]);

  useEffect(() => {
    if (status === "playing") {
      const t = window.setTimeout(() => setRevealed(true), REVEAL_DELAY_MS);
      return () => window.clearTimeout(t);
    }
    if (status === "idle" || status === "loading" || status === "ended" || status === "error") setRevealed(false);
  }, [status]);

  useEffect(() => {
    if (!isTauri || !revealed) return;
    // Full screen: the whole page goes transparent. Mini window: the page stays, and only a
    // rectangle of it is cut out (body.mpv-mini + the --mini-* variables, see MiniPlayer.tsx).
    const cls = mini ? "mpv-mini" : "mpv-active";
    document.body.classList.add(cls);
    return () => document.body.classList.remove(cls);
  }, [revealed, mini]);

  return isTauri && revealed;
}
