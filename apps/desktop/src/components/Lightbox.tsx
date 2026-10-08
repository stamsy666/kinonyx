import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BackIcon, CloseIcon, Focusable, FocusGroup, NextIcon, Spinner, onBack } from "@kinonyx/ui";
import { SlideViewer } from "./SlideViewer";
import { preloadImage, proximityOrder } from "../data/imagePreload";
import { holdMusic } from "../data/music";

export interface LightboxImage {
  full?: string;
  preview?: string;
}

interface Props {
  images: LightboxImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Where frame `i` sits on the page (its card). When given, the viewer grows out of that
   *  rectangle on open and shrinks back into it on close; without it, it just fades. */
  getOrigin?: (i: number) => DOMRect | null;
}

const OPEN_MS = 460;
const CLOSE_MS = 340;
const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const EASE_IN_OUT = "cubic-bezier(0.4, 0, 0.2, 1)";

/** A clip-path that shows only `r` (the card) out of the whole window. Null if the card
 *  isn't on screen (scrolled away) — then a plain fade is used instead. */
function insetFor(r: DOMRect | null | undefined): string | null {
  if (!r || r.width < 2 || r.height < 2) return null;
  if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return null;
  const px = (n: number) => `${Math.max(0, Math.round(n))}px`;
  return `inset(${px(r.top)} ${px(window.innerWidth - r.right)} ${px(window.innerHeight - r.bottom)} ${px(r.left)} round 12px)`;
}
const FULL = "inset(0px 0px 0px 0px round 0px)";

/** Transform that makes the whole stage (the picture) look as small as the card `r`, centred on
 *  it — so while the window opens/closes the picture itself grows/shrinks, not just the frame
 *  cut out of it. */
function stageShrunk(r: DOMRect): string {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const s = Math.max(r.width / W, r.height / H);
  const dx = r.left + r.width / 2 - W / 2;
  const dy = r.top + r.height / 2 - H / 2;
  return `translate(${dx}px, ${dy}px) scale(${s})`;
}
const STAGE_FULL = "translate(0px, 0px) scale(1)";

/** Whole-window viewer for film stills. Portalled to <body> so it covers the app shell
 *  (top bar included) regardless of which screen wrapper opened it. */
export function Lightbox({ images, index, onIndex, onClose, getOrigin }: Props) {
  const [loading, setLoading] = useState(false);
  const count = images.length;
  const step = (d: number) => onIndex((index + d + count) % count);
  const root = () => document.querySelector<HTMLElement>(".lightbox");
  const closing = useRef(false);

  // Looking at the stills: the background music fades to nothing while the viewer is open.
  useEffect(() => holdMusic(), []);
  const indexRef = useRef(index);
  indexRef.current = index;

  // Opening: the window grows out of the card that was pressed (before first paint, so there
  // is no frame of the full viewer first).
  useLayoutEffect(() => {
    const el = root();
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = getOrigin?.(indexRef.current);
    const from = insetFor(rect);
    if (from && rect) {
      el.style.animation = "none"; // drop the plain fade-in; the clip-path reveal replaces it
      el.animate([{ clipPath: from }, { clipPath: FULL }], { duration: OPEN_MS, easing: EASE_OUT });
      el.querySelector<HTMLElement>(".lightbox__stage")?.animate(
        [{ transform: stageShrunk(rect) }, { transform: STAGE_FULL }],
        { duration: OPEN_MS, easing: EASE_OUT },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Closing: shrink back into the card of the frame we are on now (or fade if it is off
  // screen), and only then hand over to the parent, which unmounts the viewer.
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const el = root();
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onClose();
    const rect = getOrigin?.(indexRef.current);
    const to = insetFor(rect);
    if (to && rect) {
      el.querySelector<HTMLElement>(".lightbox__stage")?.animate(
        [{ transform: STAGE_FULL }, { transform: stageShrunk(rect) }],
        { duration: CLOSE_MS, easing: EASE_IN_OUT, fill: "forwards" },
      );
    }
    const anim = to
      ? el.animate([{ clipPath: FULL }, { clipPath: to }], { duration: CLOSE_MS, easing: EASE_IN_OUT, fill: "forwards" })
      : el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-out", fill: "forwards" });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onClose();
    };
    anim.onfinish = finish;
    window.setTimeout(finish, CLOSE_MS + 120); // safety net
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  useEffect(() => onBack(() => (close(), true)), [close]);

  // Warm the frames around the open one (next first), one after another so the shown frame
  // keeps the bandwidth, then everything else — flipping is then instant instead of waiting
  // on a ~300 KB download each time. Restarts from the new position on every flip.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await preloadImage(images[index]?.full);
      for (const i of proximityOrder(index, count)) {
        if (cancelled) return;
        await preloadImage(images[i]?.full);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count]);

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
      {/* Ordinary app buttons (Focusable): hover/press sounds and the usual focus beam. */}
      {count > 1 && (
        <>
          <Focusable
            as="button"
            className="icon-btn lightbox__btn lightbox__btn--prev"
            focusKey="lightbox:prev"
            scroll={false}
            onPress={() => step(-1)}
          >
            <BackIcon size={26} />
          </Focusable>
          <Focusable
            as="button"
            className="icon-btn lightbox__btn lightbox__btn--next"
            focusKey="lightbox:next"
            scroll={false}
            onPress={() => step(1)}
          >
            <NextIcon size={26} />
          </Focusable>
        </>
      )}
      <Focusable back as="button" className="icon-btn lightbox__btn lightbox__btn--close" focusKey="lightbox:close" scroll={false} onPress={close}>
        <CloseIcon size={24} />
      </Focusable>
      <div className="lightbox__count">
        {index + 1} / {count}
      </div>
    </FocusGroup>,
    document.body,
  );
}
