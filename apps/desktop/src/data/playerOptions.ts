import type { FrameGeneration, PlayerAdapter } from "@kinonyx/player-core";
import { useShallow } from "zustand/react/shallow";
import { useApp, type PlayerPrefs, type SubtitleBackground } from "../store/app";

export const PLAYER_VOLUME_STEP = 0.01;

export const DLSS_OPTIONS: { value: FrameGeneration; label: string }[] = [
  { value: 0, label: "Выкл." }, { value: 2, label: "×2" }, { value: 3, label: "×3" },
];

export const readFrameGeneration = () => useApp.getState().playerPrefs.frameGeneration;

export function useMpvLoadOptions(): Record<string, string> {
  return useApp(useShallow((state) => buildMpvOptions(state.playerPrefs)));
}

/** Per-title mpv options for the player settings (Settings → Плеер). Only options that differ
 *  from mpv's defaults are listed — the adapter puts back the default of any key a title
 *  stops asking for (OPTION_DEFAULTS in player-core). */
export function buildMpvOptions(prefs: PlayerPrefs): Record<string, string> {
  const o: Record<string, string> = {
    // mpv draws subtitles itself, so size/colour are its own options.
    "sub-scale": String(prefs.subtitleScale),
    "sub-color": prefs.subtitleColor,
  };
  // A dark plate behind plain text subtitles. Nothing is sent otherwise, so the default look (and an older mpv that
  // doesn't know sub-border-style) is exactly as before. ASS keeps its own style: sub-ass-override is left alone.
  Object.assign(o, subtitleBackgroundOptions(prefs.subtitleBackground));
  // Labelled (@kxnight) so it can be told apart from the voice-over's own filter.
  if (prefs.nightMode) o.af = "@kxnight:lavfi=[dynaudnorm=f=250:g=15:p=0.9]";
  if (prefs.upscale === "sharp") {
    o.scale = "spline36";
    o.cscale = "spline36";
  } else if (prefs.upscale === "max") {
    o.scale = "ewa_lanczossharp";
    o.cscale = "ewa_lanczossharp";
  }
  if (prefs.deband) o.deband = "yes";
  if (prefs.smooth) {
    // The frames are timed to the screen and blended between (no new frames are made — it takes out the jerks of 24 fps on a 60 Hz screen).
    o["video-sync"] = "display-resample";
    o.interpolation = "yes";
    o.tscale = "oversample";
  }
  if (prefs.toneMapping !== "auto") {
    o["tone-mapping"] = prefs.toneMapping === "soft" ? "bt.2390" : "hable";
    o["hdr-compute-peak"] = "yes";
  }
  if (prefs.hdrOutput) o["target-colorspace-hint"] = "yes";
  Object.assign(o, aspectOptions(prefs.aspect));
  return o;
}

/** The mpv options that make each picture shape (the other two are put back to their defaults). */
export function aspectOptions(mode: PlayerPrefs["aspect"]): Record<string, string> {
  return {
    "video-aspect-override": mode === "16:9" || mode === "4:3" || mode === "21:9" ? mode : "-1",
    keepaspect: mode === "stretch" ? "no" : "yes",
    panscan: mode === "fill" ? "1" : "0",
  };
}

/** The picture options for a live change: every key with its value, or mpv's default. */
export function liveMpvOptions(prefs: PlayerPrefs): Record<string, string> {
  const base: Record<string, string> = {
    scale: "bilinear",
    cscale: "bilinear",
    deband: "no",
    "video-sync": "audio",
    interpolation: "no",
    tscale: "mitchell",
    "tone-mapping": "auto",
    "hdr-compute-peak": "auto",
    "target-colorspace-hint": "no",
    ...aspectOptions("auto"),
  };
  const set = buildMpvOptions(prefs);
  for (const k of Object.keys(base)) if (set[k] !== undefined) base[k] = set[k];
  return base;
}


/** The mpv options of the subtitle plate: only the dark plate asks for anything. */
export function subtitleBackgroundOptions(mode: SubtitleBackground): Record<string, string> {
  return mode === "dark" ? { "sub-border-style": "background-box", "sub-back-color": "0/0/0/0.62" } : {};
}

/** mpv's own sub-back-color before the plate first changed it (it is also the colour of the text's shadow). */
let originalBackColor: string | undefined;

/**
 * Applies the subtitle plate to the playing video at once (the player opened after it takes the option above). Going
 * back from the dark plate puts mpv's outline and its original back colour back.
 */
export async function applySubtitleBackground(adapter: PlayerAdapter | null | undefined, mode: SubtitleBackground): Promise<void> {
  if (!adapter?.setProp) return;
  try {
    if (originalBackColor === undefined && adapter.getProp) originalBackColor = (await adapter.getProp("sub-back-color")) ?? "";
    if (mode === "dark") {
      await adapter.setProp("sub-border-style", "background-box");
      await adapter.setProp("sub-back-color", "0/0/0/0.62");
    } else {
      await adapter.setProp("sub-border-style", "outline-and-shadow");
      if (originalBackColor) await adapter.setProp("sub-back-color", originalBackColor);
    }
  } catch {
    /* an mpv without sub-border-style (older than 0.38): its subtitles just keep their look */
  }
}
