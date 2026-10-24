import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { BackIcon, FocusGroup, NextIcon } from "@kinonyx/ui";
import { FocusHighlight } from "./FocusHighlight";

interface Props {
  label: string;
  description?: string;
  children: ReactNode;
  count: number;
  /** Exactly this many cards fill the row width; the rest are paged with the arrows.
   *  Without it cards keep their own width. */
  perView?: number;
  className?: string;
  /** Centred shelf heading (the catalog pages' sketch). */
  headClassName?: string;
}

// The part of a card the arrows should sit on — not the caption underneath it.
const MEDIA = ".movie-card__poster, .actor-card__avatar, .still-card";

/**
 * Every shelf remembers the card you were last on (the group keeps its last focused child), so
 * going back to a shelf you have already visited lands on that card. A shelf you have NOT visited
 * yet is entered on its FIRST card — not on whichever column happens to be nearest — until you move
 * inside it. One listener for all shelves, installed while any is on the screen.
 */
let shelves = 0;
const visited = new WeakSet<Element>();
const markVisited = (e: Event) => {
  const g = (e.target as Element | null)?.closest?.(".row-scroll__group");
  if (g) visited.add(g);
};
function onShelfKey(e: KeyboardEvent) {
  const current = document.querySelector<HTMLElement>(".row-scroll__group .is-focused, .home-banner.is-focused, .hero__btn.is-focused");
  const group = current?.closest<HTMLElement>(".row-scroll__group");
  if (group) visited.add(group);
  const down = e.key === "ArrowDown";
  if ((!down && e.key !== "ArrowUp") || !current || document.querySelector(".modal, [role=dialog]")) return;
  const all = [...document.querySelectorAll<HTMLElement>(".row-scroll__group")];
  let next: HTMLElement | undefined;
  if (group) next = all[all.indexOf(group) + (down ? 1 : -1)];
  else if (down) next = all.find((g) => current.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (!next || visited.has(next)) return;
  const first = next.querySelector<HTMLElement>("[data-fk]");
  const origin = (group ?? current).getBoundingClientRect().top;
  const there = next.getBoundingClientRect().top;
  if (!first || (down ? there <= origin : there >= origin)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  setFocus(first.dataset.fk!);
}

/**
 * Horizontal shelf with ← / → overlaid on the pictures at either edge (mouse targets;
 * remote/keyboard users just move focus, which scrolls the card into view). Each arrow
 * shows only when there's something to scroll to in its direction.
 */
export function RowScroll({ label, children, count, perView, className = "", headClassName = "" }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const [arrowTop, setArrowTop] = useState<number | null>(null);

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    });
    const media = el.querySelector<HTMLElement>(MEDIA);
    if (media) {
      const row = el.parentElement!.getBoundingClientRect();
      const m = media.getBoundingClientRect();
      setArrowTop(m.top - row.top + m.height / 2);
    }
  }, []);

  useEffect(() => {
    if (shelves++ === 0) {
      window.addEventListener("keydown", onShelfKey, true);
      window.addEventListener("pointerover", markVisited, true);
    }
    return () => {
      if (--shelves === 0) {
        window.removeEventListener("keydown", onShelfKey, true);
        window.removeEventListener("pointerover", markVisited, true);
      }
    };
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Images arrive after first layout and change the media box height.
    const first = el.querySelector(MEDIA);
    if (first) ro.observe(first);
    return () => ro.disconnect();
  }, [measure, count]);

  if (count === 0) return null;

  const page = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
  };

  const style = {
    ...(perView ? { "--per-view": perView } : {}),
    ...(arrowTop != null ? { "--arrow-top": `${arrowTop}px` } : {}),
  } as CSSProperties;

  return (
    <section className={`shelf ${className}`}>
      <div className={`shelf__head ${headClassName}`}>
        <h2 className="shelf__title">{label}</h2>
      </div>
      <div className={`row-scroll ${perView ? "row-scroll--paged" : ""}`} style={style}>
        <div className="row-scroll__track" ref={trackRef} onScroll={measure}>
          {/* The row remembers which card you were on: going down and back up lands on the same card,
              and the row stays scrolled where it was. A row you have not visited yet is entered on its
              first card (norigin's default there), not on whichever column happened to be nearest. */}
          <FocusGroup className="row-scroll__group" saveLastFocusedChild>
            <FocusHighlight />
            {children}
          </FocusGroup>
        </div>
        {!edges.start && (
          <button className="row-scroll__arrow row-scroll__arrow--prev" onClick={() => page(-1)} aria-label="Назад">
            <BackIcon size={20} />
          </button>
        )}
        {!edges.end && (
          <button className="row-scroll__arrow row-scroll__arrow--next" onClick={() => page(1)} aria-label="Дальше">
            <NextIcon size={20} />
          </button>
        )}
      </div>
    </section>
  );
}
