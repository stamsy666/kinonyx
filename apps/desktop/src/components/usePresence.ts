import { useEffect } from "react";
import { useApp } from "../store/app";
import { clearPresence, setPresence } from "../data/discord";

/** Discord status while a player is open: the title, and an elapsed timer while it plays
 *  ("На паузе" without one). `elapsedSec` = how far into the film, so Discord's timer matches
 *  the position; omit it for live TV (the timer then starts when the status is first sent). */
export function usePresence(meta: { details: string; state: string } | null, playing: boolean, elapsedSec?: number) {
  const enabled = useApp((s) => s.discordEnabled);
  useEffect(() => {
    if (!meta) return;
    if (!enabled) {
      clearPresence();
      return;
    }
    if (playing) {
      setPresence({
        details: meta.details,
        state: meta.state,
        startedAt: Math.floor(Date.now() / 1000 - (elapsedSec ?? 0)),
      });
    } else {
      setPresence({ details: meta.details, state: "На паузе" });
    }
    // The timer start is taken once per play/pause/title change, not on every position tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.details, meta?.state, playing, enabled]);
}
