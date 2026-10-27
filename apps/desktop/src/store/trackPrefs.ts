import type { Track } from "@kinonyx/player-core";

const KEY = "kinonyx.trackPrefs";

/** What a track looked like when it was picked — a track id is only good for one file, language and name aren't. */
export interface TrackChoice {
  lang: string;
  title: string;
}

/** Per film or series: the chosen sound track and subtitles; `subtitle: "off"` = the user turned them off. */
export interface FilmTrackPrefs {
  audio?: TrackChoice;
  subtitle?: TrackChoice | "off";
}

function read(): Record<number, FilmTrackPrefs> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Record<number, FilmTrackPrefs>;
  } catch {
    /* falls through to empty */
  }
  return {};
}

export function getTrackPrefs(filmId: number): FilmTrackPrefs | undefined {
  return read()[filmId];
}

export function rememberTrack(filmId: number, kind: "audio" | "subtitle", track: Track | null): void {
  const all = read();
  const mine = { ...(all[filmId] ?? {}) };
  if (kind === "audio") {
    if (!track) return;
    mine.audio = { lang: (track.lang ?? "").toLowerCase(), title: norm(track.title) };
  } else {
    mine.subtitle = track ? { lang: (track.lang ?? "").toLowerCase(), title: norm(track.title) } : "off";
  }
  all[filmId] = mine;
  // The newest 200 films are enough; the object keeps insertion order for string-like keys, so cap by count.
  const keys = Object.keys(all);
  if (keys.length > 200) delete all[Number(keys[0])];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* choice just won't survive a restart */
  }
}

function norm(title?: string): string {
  return (title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The track of a new file that is the same as the remembered choice: same language and name, else same language. */
export function matchTrack(tracks: Track[], choice: TrackChoice): Track | undefined {
  const sameLang = tracks.filter((t) => (t.lang ?? "").toLowerCase() === choice.lang);
  if (sameLang.length === 0) return undefined;
  return sameLang.find((t) => norm(t.title) === choice.title) ?? sameLang[0];
}
