import { adultStreamsFast } from "./api";

const AGE_KEY = "kinonyx.adultOk";

/** The viewer confirmed they are an adult (asked once, remembered). */
export function adultConfirmed(): boolean {
  try {
    return localStorage.getItem(AGE_KEY) === "1";
  } catch {
    return false;
  }
}
export function confirmAdult() {
  try {
    localStorage.setItem(AGE_KEY, "1");
  } catch {
    /* asked again next time */
  }
}

type Streams = Awaited<ReturnType<typeof adultStreamsFast>>;

// A card that has the focus for a moment is resolved in the background, so by the time it is opened the streams are
// already there. Failures are dropped so they can be retried; links expire, so an old entry is not reused.
const resolved = new Map<string, { at: number; promise: Promise<Streams> }>();
const KEEP_MS = 10 * 60_000;

/** The files of a video, best last, read from its page (the site's links are tied to the viewer and expire). */
export function adultStreams(key: string): Promise<Streams> {
  const hit = resolved.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.promise;
  const promise = adultStreamsFast(key);
  resolved.set(key, { at: Date.now(), promise });
  promise.catch(() => resolved.delete(key));
  return promise;
}

// One card at a time: the page of a video is read only for the card that keeps the focus for a moment (not one per
// card on the screen, which would be a burst of requests).
let focusTimer = 0;

/** The focused card's streams are resolved ahead, so opening it is instant. */
export function adultFocused(key: string) {
  window.clearTimeout(focusTimer);
  focusTimer = window.setTimeout(() => void adultStreams(key).catch(() => undefined), 500);
}
