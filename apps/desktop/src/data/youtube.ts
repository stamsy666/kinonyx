import { invoke } from "@tauri-apps/api/core";
import type { TrailerQuality } from "./api";

export interface YoutubeVideo {
  id: string;
  title: string;
  channel: string;
  duration: string;
  details?: string[];
  channelId?: string;
  avatar?: string;
  isLive?: boolean;
}

export interface YoutubeCursor {
  token: string;
  source: "web_home" | "history" | "search" | "public_search" | "channel" | "channel_session";
  context?: unknown;
}

export interface YoutubeVideoPage {
  videos: YoutubeVideo[];
  next: YoutubeCursor | null;
}

export interface YoutubeFeed extends YoutubeVideoPage {
  connected: boolean;
  expired: boolean;
  error?: string;
  author?: YoutubeAuthor;
  recentUploadsOnly?: boolean;
}

export interface ImportedYoutubeSession {
  revision: number;
  feed: YoutubeFeed | null;
}

let importedSession: ImportedYoutubeSession = { revision: 0, feed: null };
const sessionListeners = new Set<() => void>();

export function getImportedYoutubeSession() {
  return importedSession;
}

export function subscribeYoutubeSession(listener: () => void) {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}

export async function importYoutubeCookies(source: "browser" | "file"): Promise<boolean> {
  const command = source === "browser" ? "youtube_connect_from_browser" : "youtube_connect";
  const linked = await invoke<YoutubeFeed | null>(command);
  if (!linked) return false;
  importedSession = { revision: importedSession.revision + 1, feed: linked };
  for (const listener of sessionListeners) listener();
  return true;
}

export interface YoutubeAuthor {
  id?: string;
  name: string;
  avatar?: string;
}

export interface YoutubeChannel extends YoutubeAuthor {
  id: string;
}

export interface YoutubePlayback {
  videoId: string;
  author: YoutubeAuthor;
  live: boolean;
}

export interface YoutubeStream {
  qualities: TrailerQuality[];
  defaultIndex: number;
  title?: string;
  channel?: string;
  channelId?: string;
  isLive?: boolean;
}

