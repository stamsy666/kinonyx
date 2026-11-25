import { refreshMpvAudioDevice } from "@kinonyx/player-core";
import { useApp } from "../store/app";
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

export function resolveAudioDevice(preferred: string, devices: AudioDevice[]): string {
  return devices.some((device) => device.name === preferred) ? preferred : "auto";
}

export async function preferredMpvAudioDevice(): Promise<string> {
  const preferred = useApp.getState().audioDevice;
  if (!preferred || preferred === "auto") return "auto";
  const devices = await listAudioDevices();
  return resolveAudioDevice(useApp.getState().audioDevice, devices);
}

export function installPlaybackAudioDevice() {
  if (!isTauri) return;
  return useApp.subscribe((state, previous) => {
    if (state.audioDevice !== previous.audioDevice) {
      void refreshMpvAudioDevice(preferredMpvAudioDevice).catch((e) => console.warn("[mpv] Audio output:", e));
    }
  });
}
