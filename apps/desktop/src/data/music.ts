import { useApp } from "../store/app";
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

let audio: HTMLAudioElement | null = null;
let trackIndex = 0;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener("ended", () => {
      trackIndex = (trackIndex + 1) % MUSIC_TRACKS.length;
      loadCurrentTrack();
      reconcile();
    });
  }
  return audio;
}

function loadCurrentTrack() {
  const track = MUSIC_TRACKS[trackIndex];
  const el = getAudio();
  el.src = track.url;
  useApp.getState().setCurrentTrack(track);
}

/** Plays/pauses/adjusts volume to match the store's current settings — called on
 *  every relevant state change so the engine never drifts from what the UI shows. */
function reconcile() {
  const { musicEnabled, musicVolume, screen } = useApp.getState();
  const el = getAudio();
  el.volume = musicVolume;

  const inPlayer = screen.name === "player" || screen.name === "tv-player";
  const shouldPlay = musicEnabled && !inPlayer;

  if (shouldPlay) {
    if (!el.src) loadCurrentTrack();
    if (el.paused) void el.play().catch(() => undefined);
  } else if (!el.paused) {
    el.pause();
  }
}

/** Wires background-music playback to the store. Call once, at app startup. */
export function installMusicEngine() {
  reconcile();
  useApp.subscribe((state, prev) => {
    if (state.musicEnabled !== prev.musicEnabled || state.musicVolume !== prev.musicVolume || state.screen.name !== prev.screen.name) {
      reconcile();
    }
  });
}
