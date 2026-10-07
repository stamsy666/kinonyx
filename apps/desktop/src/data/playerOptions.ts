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
  return o;
}
