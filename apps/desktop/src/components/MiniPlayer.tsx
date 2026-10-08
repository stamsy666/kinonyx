import { useEffect, type MutableRefObject } from "react";
import type { PlayerAdapter } from "@kinonyx/player-core";
import { CloseIcon, ExpandIcon, PauseIcon, PlayIcon } from "@kinonyx/ui";

/*
 * The mini player.
 *
 * mpv draws into a native surface BEHIND the transparent webview. Full screen, the whole page is
 * made transparent (body.mpv-active). The mini window instead keeps the page and cuts one
 * rectangle out of it — `body.mpv-mini` clips the body with an even-odd polygon whose hole is the
 * mini window's video area (variables --mini-x/-y/-w/-h/-vw/-vh, theme.css) — and tells mpv to
 * draw the picture only inside that rectangle (video-margin-ratio-*). The control bar sits
 * under the video, outside the hole, because anything drawn inside the hole would be clipped.
 *
 * Keep these numbers in sync with .mini-player in theme.css.
 */
export const MINI_W = 400;
export const MINI_H = 225;
export const MINI_BAR = 46;
export const MINI_GAP = 24;

/** While `mini`: positions the cut-out and squeezes mpv's picture into it; undoes both after. */
export function useMiniLayout(adapterRef: MutableRefObject<PlayerAdapter | null>, mini: boolean) {
  useEffect(() => {
    if (!mini) return;
    const style = document.body.style;
    const apply = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x = vw - MINI_GAP - MINI_W;
      const y = vh - MINI_GAP - MINI_BAR - MINI_H;
      style.setProperty("--mini-x", `${x}px`);
      style.setProperty("--mini-y", `${y}px`);
      style.setProperty("--mini-w", `${MINI_W}px`);
      style.setProperty("--mini-h", `${MINI_H}px`);
      style.setProperty("--mini-vw", `${vw}px`);
      style.setProperty("--mini-vh", `${vh}px`);
      void adapterRef.current?.setVideoMargins?.({
        left: x / vw,
        right: MINI_GAP / vw,
        top: y / vh,
        bottom: (MINI_GAP + MINI_BAR) / vh,
      });
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      for (const v of ["x", "y", "w", "h", "vw", "vh"]) style.removeProperty(`--mini-${v}`);
      void adapterRef.current?.setVideoMargins?.(null);
    };
  }, [adapterRef, mini]);
}

/** What the player screens render while minimised: a video area and a slim control bar. */
export function MiniPlayerChrome({
  title,
  playing,
  onToggle,
  onExpand,
  onClose,
}: {
  title: string;
  playing: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mini-player">
      {/* Black until mpv has a frame; then the body clip-path cuts this area out and mpv shows through. */}
      <div className="mini-player__video" />
      <div className="mini-player__bar">
        <div className="mini-player__title" title={title}>
          {title}
        </div>
        <button className="mini-player__btn" onClick={onToggle} aria-label={playing ? "Пауза" : "Играть"}>
          {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>
        <button className="mini-player__btn" onClick={onExpand} aria-label="Развернуть">
          <ExpandIcon size={18} />
        </button>
        <button className="mini-player__btn" onClick={onClose} aria-label="Закрыть">
          <CloseIcon size={18} />
        </button>
      </div>
    </div>
  );
}

/** Runs `close` when the viewer presses anywhere outside `.volume-control` while `open`. */
export function useCloseOnOutsidePress(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.(".volume-control")) return;
      close();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
