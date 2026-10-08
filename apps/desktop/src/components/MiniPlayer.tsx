import { useEffect } from "react";
import { CloseIcon, ExpandIcon, PauseIcon, PlayIcon } from "@kinonyx/ui";

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
      <div className="mini-player__top" data-tauri-drag-region>
        <div className="mini-player__title" title={title} data-tauri-drag-region>
          {title}
        </div>
        <button className="mini-player__btn" onClick={onExpand} aria-label="Развернуть">
          <ExpandIcon size={18} />
        </button>
        <button className="mini-player__btn" onClick={onClose} aria-label="Закрыть">
          <CloseIcon size={18} />
        </button>
      </div>
      <div className="mini-player__bar">
        <button className="mini-player__btn" onClick={onToggle} aria-label={playing ? "Пауза" : "Играть"}>
          {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
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
