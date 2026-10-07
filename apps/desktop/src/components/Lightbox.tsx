import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BackIcon, CloseIcon, Focusable, FocusGroup, NextIcon, Spinner, onBack } from "@kinonyx/ui";
import { SlideViewer } from "./SlideViewer";

export interface LightboxImage {
  full?: string;
  preview?: string;
}

interface Props {
  images: LightboxImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}

/** Whole-window viewer for film stills. Portalled to <body> so it covers the app shell
 *  (top bar included) regardless of which screen wrapper opened it. */
export function Lightbox({ images, index, onIndex, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const count = images.length;
  const step = (d: number) => onIndex((index + d + count) % count);

  useEffect(() => onBack(() => (onClose(), true)), [onClose]);

  return createPortal(
    <FocusGroup focusKey="lightbox" className="lightbox" isFocusBoundary>
      <Focusable
        focusKey="lightbox:stage"
        className="lightbox__stage"
        autoFocus
        scroll={false}
        hoverFocus={false}
        onArrowPress={(direction) => {
          if (direction === "left" || direction === "right") step(direction === "left" ? -1 : 1);
          return false;
        }}
      >
        {images.length > 0 && <SlideViewer images={images} index={index} onLoadingChange={setLoading} />}
      </Focusable>

      {loading && (
        <div className="lightbox__loading">
          <Spinner />
        </div>
      )}
      {count > 1 && (
        <>
          <button className="lightbox__nav lightbox__nav--prev" onClick={() => step(-1)} aria-label="Предыдущий кадр">
            <BackIcon size={26} />
          </button>
          <button className="lightbox__nav lightbox__nav--next" onClick={() => step(1)} aria-label="Следующий кадр">
            <NextIcon size={26} />
          </button>
        </>
      )}
      <button className="lightbox__close" onClick={onClose} aria-label="Закрыть">
        <CloseIcon size={24} />
      </button>
      <div className="lightbox__count">
        {index + 1} / {count}
      </div>
    </FocusGroup>,
    document.body,
  );
}
