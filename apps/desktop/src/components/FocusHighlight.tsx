import { useEffect, useRef } from "react";

interface Props {
  /** How far the plate reaches past the item on every side. Needs that much room inside
   *  whatever clips the row (RowScroll's track padding, `.screen__body`'s grid slack);
   *  0 for full-width list rows, where there's nowhere to reach out to. */
  pad?: number;
  radius?: number | string;
}

/**
 * Aceternity's "card hover effect" (ui.aceternity.com/components/card-hover-effect): a soft
 * plate behind the active card that slides over to the next one instead of blinking out and
 * in. The original follows mouse hover via motion's `layoutId`; here it follows *focus* —
 * which the mouse moves too (hover focuses), so it's the same effect with the mouse and
 * with the remote. Plain CSS transitions on one absolutely positioned element instead of
 * pulling in `motion` for it.
 *
 * Render it as the first child of a row/grid/list; it follows the focused element anywhere
 * inside that container (however deeply nested), and fades out (after a beat, like the
 * original's exit delay) once focus leaves the container. Items paint above it because every
 * Focusable is `position: relative` and comes later in the DOM.
 */
export function FocusHighlight({ pad = 10, radius = 22 }: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const plate = ref.current;
    const row = plate?.parentElement;
    if (!plate || !row) return;
    const PAD = pad;
    // Item offsets are measured against the container, so it has to be their offsetParent.
    if (getComputedStyle(row).position === "static") row.style.position = "relative";
    let current: HTMLElement | null = null;

    // Layout offsets (not getBoundingClientRect): unaffected by the focus scale-up transition
    // that's just starting when the class flips, and — with the plate living inside the same
    // scrolled content — already in the right coordinates for a scrolling list.
    const offsetWithin = (el: HTMLElement) => {
      let x = 0;
      let y = 0;
      let n: HTMLElement | null = el;
      while (n && n !== row) {
        x += n.offsetLeft;
        y += n.offsetTop;
        n = n.offsetParent as HTMLElement | null;
      }
      return n === row ? { x, y } : null;
    };

    const place = () => {
      const item = row.querySelector<HTMLElement>(".is-focused");
      const at = item ? offsetWithin(item) : null;
      if (!item || !at) {
        if (current) plate.classList.remove("is-visible");
        current = null;
        return;
      }
      // Arriving from another row: appear in place, don't slide in from wherever it was.
      const jump = !current;
      if (jump) plate.style.transition = "none";
      plate.style.transform = `translate(${at.x - PAD}px, ${at.y - PAD}px)`;
      plate.style.width = `${item.offsetWidth + PAD * 2}px`;
      plate.style.height = `${item.offsetHeight + PAD * 2}px`;
      if (jump) {
        void plate.offsetWidth;
        plate.style.transition = "";
        plate.classList.add("is-visible");
      }
      current = item;
    };

    // Focusable toggles `is-focused` on itself — watching class changes catches every move,
    // keyboard or mouse, without threading a callback through every card type.
    const mo = new MutationObserver((records) => {
      if (records.some((r) => r.target !== plate)) place();
    });
    mo.observe(row, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    const ro = new ResizeObserver(() => current && place());
    ro.observe(row);
    place();
    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, [pad]);

  return <span ref={ref} className="focus-highlight" style={{ borderRadius: radius }} aria-hidden />;
}
