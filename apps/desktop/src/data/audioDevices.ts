import { isTauri } from "./io";

export interface AudioDevice {
  /** What mpv's `audio-device` takes, e.g. `wasapi/{guid}`. */
  name: string;
  description: string;
}

/** The sound outputs mpv can play to (read by a throwaway mpv core in Rust). */
export async function listAudioDevices(): Promise<AudioDevice[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AudioDevice[]>("audio_devices");
}
