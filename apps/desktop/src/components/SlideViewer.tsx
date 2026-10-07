import { useEffect, useRef, useState } from "react";
import { ProgressiveImg } from "./ProgressiveImg";

export interface SlideImage {
  full?: string;
  preview?: string;
}

interface Props {
  images: SlideImage[];
  index: number;
  className?: string;
  onLoadingChange?: (loading: boolean) => void;
}

const SLIDE_MS = 300;

/**
 * Carousel-style slide transition for the still viewers (gallery frame + fullscreen
 * lightbox): the outgoing frame slides out and the incoming one slides in from the side
 * that matches the flip direction, instead of the old hard swap-in-place.
 */
export function SlideViewer({ images, index, className, onLoadingChange }: Props) {
  const count = images.length;
  const prevIndexRef = useRef(index);
  const [leaving, setLeaving] = useState<{ img: SlideImage; dir: 1 | -1 } | null>(null);

  useEffect(() => {
    const from = prevIndexRef.current;
    prevIndexRef.current = index;
    if (from === index || !count) return;
    // Shortest wrap-aware direction, so e.g. last -> first still reads as "forward".
    const forward = ((index - from + count) % count) <= count / 2;
    setLeaving({ img: images[from] ?? {}, dir: forward ? 1 : -1 });
    const t = setTimeout(() => setLeaving(null), SLIDE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const current = images[index];
  if (!current) return null;

  return (
    <div className={`slide-viewer ${className ?? ""}`}>
      {leaving && (
        <div className={`slide-viewer__frame slide-viewer__frame--out-${leaving.dir > 0 ? "left" : "right"}`}>
          <ProgressiveImg src={leaving.img.full} placeholder={leaving.img.preview} />
        </div>
      )}
      <div
        key={index}
        className={`slide-viewer__frame ${leaving ? `slide-viewer__frame--in-${leaving.dir > 0 ? "right" : "left"}` : ""}`}
      >
        <ProgressiveImg src={current.full} placeholder={current.preview} onLoadingChange={onLoadingChange} />
      </div>
    </div>
  );
}
