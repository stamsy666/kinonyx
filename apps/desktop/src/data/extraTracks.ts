import type { ExtraTrack } from "@kinonyx/player-core";
import { streamUrlFor, type TorrentFile } from "./api";
import { langOfName, pickCompanions } from "./companions";

/** The subtitles and sound tracks of a release that go with `video`, as tracks the player can add. */
export async function buildExtraTracks(hash: string, all: TorrentFile[], video: TorrentFile, videos: TorrentFile[]): Promise<ExtraTrack[]> {
  const { subs, audio } = pickCompanions(all, video, videos.length ? videos : [video]);
  const make = async (f: TorrentFile, kind: ExtraTrack["kind"]): Promise<ExtraTrack | null> => {
    try {
      return { kind, url: await streamUrlFor(hash, f), title: `${f.name} · из раздачи`, lang: langOfName(f.name) };
    } catch {
      return null;
    }
  };
  const out = await Promise.all([...subs.map((f) => make(f, "subtitle")), ...audio.map((f) => make(f, "audio"))]);
  return out.filter((t): t is ExtraTrack => t !== null);
}
