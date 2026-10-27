import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon } from "@kinonyx/ui";

/**
 * The round sign that flashes in the middle of the picture when the video is paused or goes on — it comes up, swells and fades, as
 * in YouTube. It follows the player's status, so a key, a click and the phone remote all give it. Starting a video, buffering and
 * seeking are not a pause: only "playing → paused" and "paused → playing" count.
 */
export function PlayFlash({ status }: { status: string }) {
  const before = useRef(status);
  const [flash, setFlash] = useState<{ kind: "play" | "pause"; n: number } | null>(null);

  useEffect(() => {
    const was = before.current;
    before.current = status;
    if (status === was) return;
    if (status === "paused" && (was === "playing" || was === "buffering")) setFlash((f) => ({ kind: "pause", n: (f?.n ?? 0) + 1 }));
    else if (status === "playing" && was === "paused") setFlash((f) => ({ kind: "play", n: (f?.n ?? 0) + 1 }));
  }, [status]);

  if (!flash) return null;
  return (
    <div className="play-flash" aria-hidden="true">
      <span className="play-flash__disc" key={flash.n} onAnimationEnd={() => setFlash(null)}>
        {flash.kind === "play" ? <PlayIcon size={44} /> : <PauseIcon size={44} />}
      </span>
    </div>
  );
}
