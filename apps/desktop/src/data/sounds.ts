import { setSoundHandlers } from "@kinonyx/ui";
import { useApp } from "../store/app";

export type SoundCategory = "buttons" | "navigation" | "menuNavigation" | "typing";

export interface SoundOption {
  id: string;
  label: string;
  url: string;
}

function loadCategory(glob: Record<string, string>, prefix: string): SoundOption[] {
  return Object.keys(glob)
    .sort()
    .map((path, i) => ({ id: `${prefix}:${i}`, label: `Звук ${i + 1}`, url: glob[path] }));
}

const buttonsGlob = import.meta.glob("../assets/sounds/buttons/*.ogg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const navigationGlob = import.meta.glob("../assets/sounds/navigation/*.ogg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const menuNavigationGlob = import.meta.glob("../assets/sounds/menu-navigation/*.ogg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const typingGlob = import.meta.glob("../assets/sounds/typing/*.ogg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export const SOUND_OPTIONS: Record<SoundCategory, SoundOption[]> = {
  buttons: loadCategory(buttonsGlob, "buttons"),
  navigation: loadCategory(navigationGlob, "navigation"),
  menuNavigation: loadCategory(menuNavigationGlob, "menuNavigation"),
  typing: loadCategory(typingGlob, "typing"),
};

export const SOUND_CATEGORY_LABELS: Record<SoundCategory, string> = {
  buttons: "Кнопки",
  navigation: "Навигация",
  menuNavigation: "Навигация в меню",
  typing: "Печать текста",
};

export const SOUND_CATEGORIES: SoundCategory[] = ["buttons", "navigation", "menuNavigation", "typing"];

// Web Audio, not <audio>.cloneNode(): each play used to clone a cached <audio> element and
// call .play() on the clone — which re-requests the same file over HTTP every single time
// (a clone starts with no buffered data of its own). In the real desktop app (WebView2, not
// this project's browser dev-preview, which is a different engine and didn't show the bug)
// that repeated request hit the Vite dev server with net::ERR_CACHE_OPERATION_NOT_SUPPORTED
// every time — confirmed live in the WebView2 DevTools console — so navigation/button/typing
// sounds never actually played. Fetching each file once, decoding it, and replaying the
// decoded buffer from memory needs no network at all after the first load, so this can't
// hit that bug regardless of engine; it also means overlapping fast repeats (rapid
// arrow-key navigation) for free — each play is an independent node on a shared context.
let ctx: AudioContext | null = null;

/** Created lazily, inside the first real trigger (a genuine click/keydown, not this
 *  module's own top-level code) — same reason `voiceAudio()` in VoiceOver.ts does this —
 *  an AudioContext made inside a user gesture is allowed to play without extra unlocking. */
function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

const bufferCache = new Map<string, Promise<AudioBuffer>>();

function loadBuffer(url: string): Promise<AudioBuffer> {
  let p = bufferCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((data) => audioCtx().decodeAudioData(data));
    bufferCache.set(url, p);
  }
  return p;
}

function playUrl(url: string, volume: number) {
  loadBuffer(url)
    .then((buffer) => {
      const context = audioCtx();
      const gain = context.createGain();
      gain.gain.value = Math.max(0, Math.min(1, volume));
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain).connect(context.destination);
      source.start();
    })
    .catch(() => {
      bufferCache.delete(url); // a failed fetch/decode shouldn't be cached forever
    });
}

/** Plays a specific option regardless of what's currently selected — used both for
 *  the real trigger and for the "preview on focus" row in settings. */
export function previewSound(category: SoundCategory, id: string | null, volume: number) {
  if (!id) return;
  const opt = SOUND_OPTIONS[category].find((o) => o.id === id);
  if (opt) playUrl(opt.url, volume);
}

/** Plays whatever the user currently has selected for this category (or nothing,
 *  if they turned it off). */
export function playCategorySound(category: SoundCategory) {
  const state = useApp.getState();
  previewSound(category, state.soundChoice[category], state.sfxVolume);
}

/** Wires the generic focus/press events from @kinonyx/ui to the real sound engine.
 *  Call once, at app startup. */
export function installSoundEngine() {
  setSoundHandlers({
    onPress: () => playCategorySound("buttons"),
    onMove: (group) => playCategorySound(group === "menu" ? "menuNavigation" : "navigation"),
  });
}
