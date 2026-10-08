import { useEffect, useMemo, useState } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { BackIcon, Focusable, FocusGroup, FullscreenIcon, NextIcon, Spinner } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { kpImages, type KpImage } from "../data/api";
import { img, stillLarge } from "../data/images";
import { SlideViewer } from "../components/SlideViewer";
import { Lightbox } from "../components/Lightbox";

const full = (image: KpImage) => img(stillLarge(image.imageUrl));

export function GalleryScreen({ filmId, startIndex }: { filmId: number; startIndex: number }) {
  const back = useApp((s) => s.back);
  const [images, setImages] = useState<KpImage[] | null>(null);
  const [index, setIndex] = useState(startIndex);
  const [loadingFull, setLoadingFull] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    kpImages(filmId, "STILL", 1)
      .then((r) => !cancelled && setImages(r.items ?? []))
      .catch(() => !cancelled && setImages([]));
    return () => {
      cancelled = true;
    };
  }, [filmId]);

  // Warm the neighbours so the next flip in either direction is already local.
  useEffect(() => {
    if (!images?.length) return;
    for (const d of [1, -1, 2]) {
      const neighbour = images[(index + d + images.length) % images.length];
      const url = neighbour && full(neighbour);
      if (url) new Image().src = url;
    }
  }, [images, index]);

  const count = images?.length ?? 0;
  const step = (delta: number) => {
    if (count) setIndex((i) => (i + delta + count) % count);
  };
  const current = images?.[index];
  const slides = useMemo(
    () => images?.map((i) => ({ full: full(i), preview: img(i.previewUrl) })) ?? [],
    [images],
  );

  return (
    <FocusGroup focusKey="gallery" className="screen-pad stack" style={{ height: "100%" }}>
      <div className="row" style={{ marginTop: 4 }}>
        <Focusable back as="button" className="icon-btn" focusKey="gallery:back" onPress={() => back()} scroll={false}>
          <BackIcon />
        </Focusable>
        <h1 className="screen-title">Материалы к фильму</h1>
      </div>

      {/* One focus stop for the whole viewer: Left/Right flip frames, Up leaves to "back".
          The side arrows are mouse targets only — as separate focus stops they'd make a
          single arrow press both flip the frame and hop focus between them. */}
      <Focusable
        focusKey="gallery:view"
        className="gallery-view"
        scroll={false}
        autoFocus
        hoverFocus={false}
        onPress={() => current && setFullscreen(true)}
        onArrowPress={(direction) => {
          if (direction === "left" || direction === "right") {
            step(direction === "left" ? -1 : 1);
            return false;
          }
          return true;
        }}
      >
        {!images && <Spinner />}
        {images && images.length === 0 && <p className="empty">Материалы не найдены</p>}
        {current && (
          <>
            {/* The small preview (already loaded for the "Материалы" row) shows the new
                frame the instant it's selected; the large one replaces it once downloaded. */}
            <SlideViewer images={slides} index={index} onLoadingChange={setLoadingFull} />
            {loadingFull && (
              <div className="gallery-view__loading">
                <Spinner />
              </div>
            )}
            <button className="icon-btn gallery-view__nav gallery-view__nav--prev" onClick={(e) => (e.stopPropagation(), step(-1))}>
              <BackIcon />
            </button>
            <button className="icon-btn gallery-view__nav gallery-view__nav--next" onClick={(e) => (e.stopPropagation(), step(1))}>
              <NextIcon />
            </button>
            <button
              className="gallery-view__expand"
              aria-label="На весь экран"
              onClick={(e) => (e.stopPropagation(), setFullscreen(true))}
            >
              <FullscreenIcon size={20} />
            </button>
            <div className="gallery-view__count">
              {index + 1} / {count}
            </div>
          </>
        )}
      </Focusable>

      {fullscreen && images && (
        <Lightbox
          images={images.map((i) => ({ full: full(i), preview: img(i.previewUrl) }))}
          index={index}
          onIndex={setIndex}
          onClose={() => {
            setFullscreen(false);
            // Focus lived inside the viewer; hand it back once the viewer has unmounted.
            requestAnimationFrame(() => setFocus("gallery:view"));
          }}
        />
      )}
    </FocusGroup>
  );
}
