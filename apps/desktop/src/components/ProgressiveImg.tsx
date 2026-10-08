import { useEffect, useState } from "react";
import { isImageLoaded, markImageLoaded } from "../data/imagePreload";

interface Props {
  src?: string;
  /** Lower-res version already on screen elsewhere (card preview) — shown instantly. */
  placeholder?: string;
  alt?: string;
  className?: string;
  onLoadingChange?: (loading: boolean) => void;
}

/**
 * Shows `placeholder` immediately and swaps to `src` once it has fully downloaded, so
 * the page (or the next gallery frame) reacts at once instead of sitting on a blank box
 * or the previous image while a large file arrives.
 */
export function ProgressiveImg({ src, placeholder, alt = "", className, onLoadingChange }: Props) {
  // Already downloaded (preloaded neighbour / seen before): paint the full image on the very
  // first render — no frame of the blurry placeholder in between.
  const [loaded, setLoaded] = useState<string | undefined>(() => (isImageLoaded(src) ? src : undefined));

  useEffect(() => {
    if (!src) return;
    if (isImageLoaded(src)) {
      setLoaded(src);
      onLoadingChange?.(false);
      return;
    }
    let cancelled = false;
    onLoadingChange?.(true);
    const probe = new Image();
    probe.decoding = "async";
    probe.onload = () => {
      markImageLoaded(src);
      if (cancelled) return;
      setLoaded(src);
      onLoadingChange?.(false);
    };
    probe.onerror = () => !cancelled && onLoadingChange?.(false);
    probe.src = src;
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const shown = loaded === src ? src : placeholder;
  if (!shown) return null;
  return <img className={className} src={shown} alt={alt} decoding="async" />;
}
