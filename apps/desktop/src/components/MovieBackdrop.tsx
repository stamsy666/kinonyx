import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const SLIDE_MS = 7000;

/**
 * Full-screen ambient slideshow behind the film page: the film's own stills, heavily
 * blurred, slowly zooming and cross-fading. Uses the small previews — the blur hides the
 * resolution, and they're already downloaded for the "Материалы" row.
 *
 * Portalled to <body>: the screen wrapper animates `transform` on enter, and a transformed
 * ancestor turns `position: fixed` into "fixed to that ancestor".
 */
export function MovieBackdrop({ images }: { images: string[] }) {
  const [{ index, prev }, setSlide] = useState<{ index: number; prev: number | null }>({ index: 0, prev: null });

  useEffect(() => {
    setSlide({ index: 0, prev: null });
    if (images.length < 2) return;
    const id = window.setInterval(() => {
      setSlide((s) => ({ index: (s.index + 1) % images.length, prev: s.index }));
    }, SLIDE_MS);
    return () => window.clearInterval(id);
  }, [images]);

  if (!images.length) return null;

  return createPortal(
    <div className="movie-backdrop" aria-hidden="true">
      {images.map((src, i) => (
        <div
          key={src + i}
          className={`movie-backdrop__slide ${i === index ? "is-active" : ""} ${i === prev ? "is-prev" : ""}`}
          style={{ backgroundImage: `url("${src}")` }}
        />
      ))}
      <div className="movie-backdrop__shade" />
    </div>,
    document.body,
  );
}
