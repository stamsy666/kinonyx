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
export function useMpvReveal(status: PlayerStatus, source: unknown): boolean {
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
    document.body.classList.add("mpv-active");
    return () => document.body.classList.remove("mpv-active");
  }, [revealed]);

  return isTauri && revealed;
}
