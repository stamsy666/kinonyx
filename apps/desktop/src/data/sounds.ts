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

/** Ready-made sound sets ("киты"): picking one fills the sound categories at once. Their files
 *  are not part of the per-category lists above — the ids are `kit:<kit>:<role>`. */
const kitFiles = import.meta.glob("../assets/sounds/kits/*/*.mp3", { eager: true, query: "?url", import: "default" }) as Record<
  string,
  string
>;
const kitUrl = (kit: string, name: string) => kitFiles[`../assets/sounds/kits/${kit}/${name}.mp3`];

export interface SoundKit {
  id: string;
  label: string;
  choice: Partial<Record<SoundCategory, string>>;
  /** Played when going back a screen. */
  backUrl?: string;
  /** Background music that goes with the kit (replaces the stock playlist while the kit is on). */
  music?: { title: string; artist: string; url: string };
  /** Volumes (0..1) set when the kit is picked: its music is mastered loud, its UI sounds are not. */
  volumes?: { music: number; sfx: number };
}

/** To add a kit: put select.mp3 / scroll.mp3 / back.mp3 into assets/sounds/kits/<id>/ and list it here. */
const KITS: { id: string; label: string; typing?: boolean; music?: { title: string; artist: string }; volumes?: { music: number; sfx: number } }[] = [
  { id: "ps4", label: "PS4", typing: true, music: { title: "Main", artist: "PlayStation 4" }, volumes: { music: 1, sfx: 0.15 } },
  { id: "ps5", label: "PS5", typing: true, music: { title: "Theme", artist: "PlayStation 5" }, volumes: { music: 0.05, sfx: 0.65 } },
];

export const SOUND_KITS: SoundKit[] = KITS.map(({ id, label, music, volumes, typing }) => ({
  id,
  label,
  choice: { buttons: `kit:${id}:select`, navigation: `kit:${id}:scroll`, menuNavigation: `kit:${id}:scroll`, ...(typing ? { typing: `kit:${id}:typing` } : {}) },
  backUrl: kitUrl(id, "back"),
  volumes,
  music: music && { ...music, url: kitUrl(id, "music") },
}));

const KIT_URLS: Record<string, string> = Object.fromEntries(
  KITS.flatMap(({ id, typing }) => [
    ...(typing ? [[`kit:${id}:typing`, kitUrl(id, "typing")]] : []),
    [`kit:${id}:select`, kitUrl(id, "select")],
    [`kit:${id}:scroll`, kitUrl(id, "scroll")],
  ]),
);

/** Picks a kit: fills the sound categories, turns its music on and sets its volumes.
 *  `null` puts the stock sounds back. */
export function applySoundKit(kitId: string | null) {
  const kit = SOUND_KITS.find((k) => k.id === kitId);
  const app = useApp.getState();
  for (const category of SOUND_CATEGORIES) {
    // A kit without its own typing sound leaves the stock one, so switching never keeps a stale one.
    app.setSoundChoice(category, kit?.choice[category] ?? `${category}:0`);
  }
  if (kit?.music) app.setMusicEnabled(true);
  if (kit?.volumes) {
    app.setMusicVolume(kit.volumes.music);
    app.setSfxVolume(kit.volumes.sfx);
  }
}

/** Exclusive themes bring their kit along: theme id → kit id. */
const THEME_KITS: Record<string, string> = { ps4: "ps4", ps5: "ps5" };

export function applyThemeKit(theme: string) {
  if (useApp.getState().soundPinned) return; // the viewer pressed "Применить": their mix stays
  const kit = THEME_KITS[theme];
  if (kit) applySoundKit(kit);
}

/** The kit whose sounds are selected right now (null = stock sounds / a custom mix). */
export function activeKit(): SoundKit | null {
  const buttons = useApp.getState().soundChoice.buttons;
  return SOUND_KITS.find((k) => k.choice.buttons && k.choice.buttons === buttons) ?? null;
}

/** Going back: the active kit's own sound; stock sounds have none, so the ordinary
 *  button sound is used (it is the one the press would have made). */
export function playBackSound() {
  const state = useApp.getState();
  const kit = SOUND_KITS.find((k) => k.choice.buttons && k.choice.buttons === state.soundChoice.buttons);
  if (kit?.backUrl) playUrl(kit.backUrl, state.sfxVolume);
  else playCategorySound("buttons");
}

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
  const url = KIT_URLS[id];
  if (url) return playUrl(url, volume);
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
    onBack: playBackSound,
    onMove: (group) => playCategorySound(group === "menu" ? "menuNavigation" : "navigation"),
  });
}
