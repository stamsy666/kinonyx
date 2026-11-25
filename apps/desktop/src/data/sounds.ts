import { setSoundHandlers } from "@kinonyx/ui";
import { useApp, type SoundKitId } from "../store/app";

type SoundCategory = "buttons" | "navigation" | "menuNavigation" | "typing" | "back";

const kitFiles = import.meta.glob<string>("../assets/sounds/kits/*/*.{mp3,wav}", {
  eager: true,
  query: "?url",
  import: "default",
});

export interface SoundKit {
  id: SoundKitId;
  label: string;
  sounds: Record<SoundCategory, string>;
  music?: { title: string; artist: string; url: string };
  volumes?: { music: number; sfx: number };
}

function consoleKit(
  id: "ps4" | "ps5",
  label: string,
  title: string,
  volumes: NonNullable<SoundKit["volumes"]>,
): SoundKit {
  const file = (name: string) => kitFiles[`../assets/sounds/kits/${id}/${name}.mp3`];
  return {
    id,
    label,
    sounds: { buttons: file("select"), navigation: file("scroll"), menuNavigation: file("scroll"), typing: file("typing"), back: file("back") },
    music: { title, artist: `PlayStation ${id.slice(-1)}`, url: file("music") },
    volumes,
  };
}

const appSound = (name: string) => kitFiles[`../assets/sounds/kits/app/${name}.wav`];

export const SOUND_KITS: Record<SoundKitId, SoundKit> = {
  app: {
    id: "app",
    label: "Звуки приложения",
    sounds: {
      buttons: appSound("select"),
      navigation: appSound("scroll"),
      menuNavigation: appSound("menu"),
      typing: appSound("typing"),
      back: appSound("back"),
    },
  },
  ps4: consoleKit("ps4", "PS4", "Main", { music: 1, sfx: 0.15 }),
  ps5: consoleKit("ps5", "PS5", "Theme", { music: 0.05, sfx: 0.65 }),
};

export function applySoundKit(id: SoundKitId) {
  const kit = SOUND_KITS[id];
  const app = useApp.getState();
  if (app.soundKit === id) return;
  app.setSoundKit(id);
  if (kit.music) app.setMusicEnabled(true);
  if (kit.volumes) {
    app.setMusicVolume(kit.volumes.music);
    if (app.sfxVolume > 0) app.setSfxVolume(kit.volumes.sfx);
  }
}

export function applyThemeKit(theme: string) {
  if (!useApp.getState().soundPinned && (theme === "ps4" || theme === "ps5")) applySoundKit(theme);
}

export function activeKit(): SoundKit {
  return SOUND_KITS[useApp.getState().soundKit];
}

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
  if (!url || volume <= 0) return;
  audioCtx();
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

export function previewSoundKit(id: SoundKitId, volume: number) {
  playUrl(SOUND_KITS[id].sounds.buttons, volume);
}

export function playCategorySound(category: SoundCategory) {
  const state = useApp.getState();
  playUrl(SOUND_KITS[state.soundKit].sounds[category], state.sfxVolume);
}

export function installSoundEngine() {
  setSoundHandlers({
    onPress: () => playCategorySound("buttons"),
    onBack: () => playCategorySound("back"),
    onMove: (group) => playCategorySound(group === "menu" ? "menuNavigation" : "navigation"),
  });
}
