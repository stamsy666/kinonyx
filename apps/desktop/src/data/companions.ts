import { episodeKey } from "./episodes";

/** The files of a release that belong to a video but are not it: subtitles and sound tracks laid beside it. Their own address is
 *  a stream of TorrServer, like the video's. */
export interface CompanionFile {
  id: number;
  path: string;
  name: string;
  length: number;
}

const SUB_EXT = /\.(srt|ass|ssa|sub|vtt|sup)$/i;
const AUDIO_EXT = /\.(mka|ac3|eac3|dts|dtshd|thd|aac|flac|mp3|m4a|ogg|opus|wav)$/i;
const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|mov|ts|m2ts|webm|wmv|flv|mpg|mpeg)$/i;

const dirOf = (path: string) => path.split("/").slice(0, -1).join("/");
const stemOf = (name: string) => name.replace(/\.[^.]+$/, "").toLowerCase();

/** A language from the file's own name: "Rus", "Russian", "ru", "рус", "eng"… (the track's language in the menu). */
export function langOfName(name: string): string | undefined {
  const n = name.toLowerCase();
  if (/(^|[^\p{L}])(ru|rus|russian|рус|русск\p{L}*|дубляж|dub)($|[^\p{L}])/u.test(n)) return "rus";
  if (/(^|[^\p{L}])(en|eng|english|англ\p{L}*)($|[^\p{L}])/u.test(n)) return "eng";
  if (/(^|[^\p{L}])(ua|ukr|укр\p{L}*)($|[^\p{L}])/u.test(n)) return "ukr";
  return undefined;
}

/**
 * Which of a release's files go with this video. A film: everything of that kind in its folder or under it. A pack of
 * episodes: what is named for the same episode (S01E02, 1x02, "2 серия") or by the video's own name, in any folder of the pack.
 */
export function pickCompanions(files: CompanionFile[], video: CompanionFile, videos: CompanionFile[]): { subs: CompanionFile[]; audio: CompanionFile[] } {
  const pack = videos.length > 1;
  const root = dirOf(video.path);
  const topDir = video.path.split("/")[0];
  const myEpisode = pack ? episodeKey(video) : null;
  const myStem = stemOf(video.name);

  const goes = (f: CompanionFile) => {
    if (pack) {
      if (stemOf(f.name).startsWith(myStem) || f.path.toLowerCase().includes(`/${myStem}/`)) return true;
      const theirs = episodeKey(f);
      return myEpisode !== null && theirs !== null && theirs === myEpisode;
    }
    // A film: beside it, below it, or anywhere in the release's top folder.
    return dirOf(f.path) === root || f.path.startsWith(`${root}/`) || (topDir !== video.path && f.path.startsWith(`${topDir}/`)) || root === "";
  };

  const companions = files.filter((f) => f.id !== video.id && !VIDEO_EXT.test(f.path));
  const limit = (list: CompanionFile[]) => list.filter(goes).slice(0, 12);
  return {
    subs: limit(companions.filter((f) => SUB_EXT.test(f.path))),
    audio: limit(companions.filter((f) => AUDIO_EXT.test(f.path))),
  };
}
