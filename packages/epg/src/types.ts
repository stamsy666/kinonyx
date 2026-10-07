export type CatchupType = "default" | "append" | "shift" | "flussonic" | "xc" | string;

export interface CatchupInfo {
  type: CatchupType;
  source?: string;
  days?: number;
}

export interface Channel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  tvgName?: string;
  catchup?: CatchupInfo;
  /** Raw attributes from #EXTINF, kept for provider-specific extensions. */
  attrs: Record<string, string>;
}

export interface Playlist {
  channels: Channel[];
  groups: string[];
  /** Attributes from the #EXTM3U header, e.g. url-tvg. */
  header: Record<string, string>;
  /** EPG source URLs declared in the header (url-tvg / x-tvg-url), split by comma. */
  epgUrls: string[];
}

export interface EpgChannel {
  id: string;
  displayNames: string[];
  icon?: string;
}

export interface Programme {
  channelId: string;
  /** Epoch milliseconds. */
  start: number;
  stop: number;
  title: string;
  desc?: string;
  category?: string;
}

export interface EpgData {
  channels: Map<string, EpgChannel>;
  /** Programmes per channel id, sorted by start ascending. */
  programmes: Map<string, Programme[]>;
}

export interface NowNext {
  now?: Programme;
  next?: Programme;
  /** 0..1 progress of the current programme, undefined when nothing is on. */
  progress?: number;
}
