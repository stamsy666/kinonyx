import { useEffect } from "react";
import { doesFocusableExist, setFocus } from "@noriginmedia/norigin-spatial-navigation";

/**
 * What the Apple TV-style pages (home, films, series, cartoons) share: scrolling down, the banner drifts
 * up slower than the page (`--parallax`), the rows' sheet fades in and the top row fades out (`--sheet`);
 * and Up from the first shelf goes to the banner's buttons (the nearest-neighbour search would pick a round
 * button in the corner, off screen while the rows are up), which scrolls the page back to the top.
 * `ready` — the banner has loaded (the page element exists from the start, but the numbers only matter then).
 */
export function useHomeFeel(ready: unknown) {
  useEffect(() => {
    const body = document.querySelector<HTMLElement>(".app-body");
    const page = document.querySelector<HTMLElement>(".home--tv");
    if (!body || !page) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = body.scrollTop;
        const h = body.clientHeight || 1;
        page.style.setProperty("--sheet", String(Math.min(1, Math.max(0, (y - h * 0.03) / (h * 0.2)))));
        page.style.setProperty("--parallax", `${Math.round(y * 0.4)}px`);
      });
    };
    update();
    body.addEventListener("scroll", update, { passive: true });
    return () => {
      body.removeEventListener("scroll", update);
      cancelAnimationFrame(frame);
    };
  }, [ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" || document.querySelector(".modal, [role=dialog]")) return;
      if (document.querySelector(".sx")) return; // the search page has its own moves
      if (!doesFocusableExist("hero:details")) {
        // No banner: Up from the topmost content goes to the menu button, not to whichever corner button is nearest.
        const focused = document.querySelector<HTMLElement>(".home--tv .is-focused[data-fk]");
        if (!focused || focused.closest(".home__chrome") || !doesFocusableExist("home:menu")) return;
        const tops = [...document.querySelectorAll<HTMLElement>(".home--tv [data-fk]")]
          .filter((x) => !x.closest(".home__chrome"))
          .map((x) => x.getBoundingClientRect().top);
        if (focused.getBoundingClientRect().top > Math.min(...tops) + 40) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        setFocus("home:menu");
        return;
      }
      if (!document.querySelector(".home__rows > :first-child .is-focused")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setFocus("hero:details");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
