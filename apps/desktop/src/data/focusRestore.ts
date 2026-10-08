import { doesFocusableExist, getCurrentFocusKey, setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { cancelGlides } from "@kinonyx/ui";

/**
 * "Back lands where you left". Screens remount on every navigation, so on their own they
 * come back focused on their first item, scrolled to the top — after opening the 12th film
 * of a shelf halfway down Home, Back dropped the viewer at the start of the page.
 *
 * `takeSnapshot` (on navigate) records the focused item and the page scroll; `restoreSnapshot`
 * (on back) re-applies them once the screen has remounted. Content arrives asynchronously
 * (lazy shelves load only near the viewport, API data after mount), so restore keeps trying
 * for a few seconds: scroll first — which is also what makes the lazy shelf around the saved
 * card load — then focus the card itself as soon as it exists. Any key/click/wheel from the
 * viewer ends it, so it never fights them.
 */

export interface FocusSnapshot {
  focusKey: string | null;
  scroll: { selector: string; top: number }[];
}

/** Page-level scroll containers: the app shell's body, and the full-window screens' body. */
const SCROLLERS = [".app-body", ".screen__body"];
const RESTORE_WINDOW_MS = 4000;
/** After focus lands, a late autoFocus (a shelf finishing its load) can still grab it. */
const SETTLE_MS = 700;

/** Focus details marker — Focusable skips its move sound and smooth scroll for it. */
export const RESTORE_DETAILS = { restore: true } as const;

/** Focus held just before the sidebar opened — the sidebar's own item isn't somewhere to
 *  come back to, the content under it is. */
let focusBeforeSidebar: string | null = null;

export function rememberFocusBeforeSidebar() {
  const key = getCurrentFocusKey();
  if (key && !key.startsWith("sidebar")) focusBeforeSidebar = key;
}

function contentFocusKey(): string | null {
  const key = getCurrentFocusKey();
  if (!key || key === "SN:ROOT") return null;
  return key.startsWith("sidebar") ? focusBeforeSidebar : key;
}

/** True while the current screen was reached by "Назад" with a saved focus to return to —
 *  a screen's own `autoFocus` (the home hero, which mounts late, once its slides load) must
 *  stay out of it: it grabbed focus AFTER the restore had put it back on the card and scrolled
 *  the page to itself ("the page position jumps" after Back). Cleared by the next navigation. */
let cameBackToSavedFocus = false;
export const returnedToSavedFocus = () => cameBackToSavedFocus;

export function takeSnapshot(): FocusSnapshot {
  cameBackToSavedFocus = false;
  return {
    focusKey: contentFocusKey(),
    scroll: SCROLLERS.flatMap((selector) => {
      const el = document.querySelector<HTMLElement>(selector);
      return el ? [{ selector, top: el.scrollTop }] : [];
    }),
  };
}

/** A freshly opened screen starts at the top. The scroll containers outlive the screens
 *  (only their content remounts), so without this the new page inherited the old one's
 *  scroll offset — opening an actor from a film's lower "Актёры" row landed halfway down. */
export function resetScroll() {
  cancelGlides(); // a shelf glide from the previous screen must not drag the new page down
  for (const selector of SCROLLERS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) el.scrollTop = 0;
  }
}

let cancelRunning: (() => void) | null = null;

export function restoreSnapshot(snapshot: FocusSnapshot) {
  cancelGlides();
  cameBackToSavedFocus = !!snapshot.focusKey;
  cancelRunning?.();
  const started = performance.now();
  let focusedAt = 0;
  let frame = 0;

  const stop = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("keydown", stop, true);
    window.removeEventListener("pointerdown", stop, true);
    window.removeEventListener("wheel", stop, true);
    if (cancelRunning === stop) cancelRunning = null;
  };
  cancelRunning = stop;
  window.addEventListener("keydown", stop, true);
  window.addEventListener("pointerdown", stop, true);
  window.addEventListener("wheel", stop, true);

  const tick = () => {
    const now = performance.now();
    if (now - started > RESTORE_WINDOW_MS || (focusedAt && now - focusedAt > SETTLE_MS)) return stop();

    const key = snapshot.focusKey;
    if (key && doesFocusableExist(key)) {
      if (getCurrentFocusKey() !== key) {
        // Put the page back first, then focus — the focus scroll is "nearest" for a restore,
        // so it only nudges if the card is still off-screen.
        for (const { selector, top } of snapshot.scroll) {
          const el = document.querySelector<HTMLElement>(selector);
          if (el && Math.abs(el.scrollTop - top) > 1) el.scrollTop = top;
        }
        setFocus(key, RESTORE_DETAILS);
      } else if (!focusedAt) focusedAt = now;
    } else {
      // Until the card exists, hold the page where it was — that's what brings its lazy
      // shelf into range. Once the card is focused, its own scrollIntoView takes over.
      for (const { selector, top } of snapshot.scroll) {
        const el = document.querySelector<HTMLElement>(selector);
        if (el && Math.abs(el.scrollTop - top) > 1) el.scrollTop = top;
      }
      if (!key && now - started > 300) return stop();
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

/** Closing the sidebar over the same screen: back onto the card that was focused before it opened. */
export function focusBackFromSidebar(fallbackGroupKey: string | undefined) {
  requestAnimationFrame(() => {
    if (focusBeforeSidebar && doesFocusableExist(focusBeforeSidebar)) setFocus(focusBeforeSidebar, RESTORE_DETAILS);
    else if (fallbackGroupKey) setFocus(fallbackGroupKey);
  });
}
