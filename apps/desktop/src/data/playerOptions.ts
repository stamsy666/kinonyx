import type { PlayerPrefs } from "../store/app";

/** Per-title mpv options for the player settings (Settings → Плеер). Only options that differ
 *  from mpv's defaults are listed — the adapter puts back the default of any key a title
 *  stops asking for (OPTION_DEFAULTS in player-core). */
export function buildMpvOptions(prefs: PlayerPrefs): Record<string, string> {
  const o: Record<string, string> = {
    // mpv draws subtitles itself, so size/colour are its own options.
    "sub-scale": String(prefs.subtitleScale),
    "sub-color": prefs.subtitleColor,
  };
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
  if (prefs.toneMapping !== "auto") {
    o["tone-mapping"] = prefs.toneMapping === "soft" ? "bt.2390" : "hable";
    o["hdr-compute-peak"] = "yes";
  }
  if (prefs.hdrOutput) o["target-colorspace-hint"] = "yes";
  Object.assign(o, aspectOptions(prefs.aspect));
  if (prefs.audioDevice) o["audio-device"] = prefs.audioDevice;
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
    "tone-mapping": "auto",
    "hdr-compute-peak": "auto",
    "target-colorspace-hint": "no",
    ...aspectOptions("auto"),
  };
  const set = buildMpvOptions(prefs);
  for (const k of Object.keys(base)) if (set[k] !== undefined) base[k] = set[k];
  return base;
}
