import { useApp } from "../store/app";
import { activeKit } from "./sounds";
import nostalgicMemories from "../assets/music/nostalgic-memories.mp3";
import missedCall from "../assets/music/missed-call.mp3";
import liminalFields from "../assets/music/liminal-fields.mp3";

export interface MusicTrack {
  title: string;
  artist: string;
  url: string;
}

export const MUSIC_TRACKS: MusicTrack[] = [
  { title: "Nostalgic Memories", artist: "Affection Core, C152", url: nostalgicMemories },
  { title: "Missed Call", artist: "C152", url: missedCall },
  { title: "Liminal Fields", artist: "C152", url: liminalFields },
];

export const MUSIC_CREDITS = [
  { key: "ncmfyt", title: "NCMFYT", hint: "youtube.com/@NCMFYT", url: "https://www.youtube.com/@NCMFYT" },
  { key: "c152", title: "C152", hint: "youtube.com/@c152music", url: "https://www.youtube.com/@c152music" },
  { key: "affection-core", title: "Affection Core", hint: "youtube.com/@affctncore", url: "https://www.youtube.com/@affctncore" },
];

/** The stock playlist, or the active sound kit's own music. */
function playlist(): MusicTrack[] {
  const music = activeKit()?.music;
  return music ? [music] : MUSIC_TRACKS;
}

let audio: HTMLAudioElement | null = null;
let trackIndex = 0;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener("ended", () => {
      trackIndex = (trackIndex + 1) % playlist().length;
      loadCurrentTrack();
      reconcile();
    });
  }
  return audio;
}

function loadCurrentTrack() {
  const list = playlist();
  const track = list[trackIndex % list.length];
  const el = getAudio();
  el.src = track.url;
  useApp.getState().setCurrentTrack(track);
}

// Music never cuts in or out: it fades. Out is quick (a player has just opened and must be
// heard alone), in is gentler. `level` is the fade multiplier 0..1, applied on top of the
// user's volume; the timer steps it every 40 ms.
const FADE_OUT_MS = 650;
const FADE_IN_MS = 1200;
let level = 1;
let fadeTarget = 1;
let fadeTimer: number | null = null;

function applyVolume() {
  getAudio().volume = Math.max(0, Math.min(1, useApp.getState().musicVolume * level));
}

function fadeTo(target: number) {
  fadeTarget = target;
  if (fadeTimer != null) return;
  fadeTimer = window.setInterval(() => {
    const el = getAudio();
    const step = 40 / (fadeTarget < level ? FADE_OUT_MS : FADE_IN_MS);
    level = fadeTarget < level ? Math.max(fadeTarget, level - step) : Math.min(fadeTarget, level + step);
    applyVolume();
    if (level === fadeTarget) {
      window.clearInterval(fadeTimer!);
      fadeTimer = null;
      if (fadeTarget === 0 && !el.paused) el.pause(); // silent now — stop the stream too
    }
  }, 40);
}

/** Screens that make their own sound — the background music gives way to them. */
const SOUND_SCREENS = new Set(["player", "tv-player", "web-trailer"]);

/** Something else needs silence for a while (the microphone is listening): the music fades out
 *  and comes back when every hold is released. Returns the release function. */
let holds = 0;
export function holdMusic(): () => void {
  holds++;
  reconcile();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    reconcile();
  };
}

/** Quieter, not silent: the music sinks while something the viewer is looking at is open (the
 *  stills viewer). Returns the release function. */
const DUCK_LEVEL = 0.22;
let ducks = 0;
export function duckMusic(): () => void {
  ducks++;
  reconcile();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    ducks--;
    reconcile();
  };
}

/** Plays/pauses/adjusts volume to match the store's current settings — called on
 *  every relevant state change so the engine never drifts from what the UI shows. */
function reconcile() {
  const { musicEnabled, screen } = useApp.getState();
  const el = getAudio();

  const shouldPlay = musicEnabled && holds === 0 && !SOUND_SCREENS.has(screen.name);

  if (shouldPlay) {
    if (!el.src) loadCurrentTrack();
    if (el.paused) {
      level = 0; // come back from silence, not with a jump
      void el.play().catch(() => undefined);
    }
    applyVolume();
    fadeTo(ducks > 0 ? DUCK_LEVEL : 1);
  } else if (!el.paused) {
    applyVolume();
    fadeTo(0);
  }
}

/** Wires background-music playback to the store. Call once, at app startup. */
export function installMusicEngine() {
  reconcile();
  useApp.subscribe((state, prev) => {
    if (state.soundChoice.buttons !== prev.soundChoice.buttons) {
      // A different kit: its music (or the stock playlist) starts from the top.
      trackIndex = 0;
      loadCurrentTrack();
    }
    if (
      state.soundChoice.buttons !== prev.soundChoice.buttons ||
      state.musicEnabled !== prev.musicEnabled || state.musicVolume !== prev.musicVolume || state.screen.name !== prev.screen.name) {
      reconcile();
    }
  });
}
