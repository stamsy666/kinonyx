import { useEffect, useRef } from "react";
import { useWatchStats, type WatchMeta } from "../store/watchStats";

/** Adds the time actually spent *playing* to the viewing statistics: every few seconds while
 *  `playing`, plus a final flush when playback stops or the player closes. Pauses, buffering
 *  and a sleeping laptop (gaps over 30 s) don't count. `meta` null = not tracked (trailers). */
export function useWatchTracker(playing: boolean, meta: WatchMeta | null) {
  const metaRef = useRef(meta);
  metaRef.current = meta;
  useEffect(() => {
    if (!playing) return;
    let last = Date.now();
    const flush = () => {
      const now = Date.now();
      const sec = (now - last) / 1000;
      last = now;
      const m = metaRef.current;
      if (m && sec > 0 && sec < 30) useWatchStats.getState().add(sec, m);
    };
    const id = window.setInterval(flush, 5000);
    return () => {
      window.clearInterval(id);
      flush();
    };
  }, [playing]);
}
