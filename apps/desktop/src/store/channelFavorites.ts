import { create } from "zustand";
import type { Channel } from "@kinonyx/epg";

const KEY = "kinonyx.channelFavorites";

export interface FavoriteChannel {
  /** Which saved playlist this channel came from — needed to reload the right one
   *  before the player can resolve the channel id again (see store/tv.ts). */
  playlistId: string;
  channel: Channel;
}

function read(): FavoriteChannel[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as FavoriteChannel[];
  } catch {
    /* falls through to empty */
  }
  return [];
}

function write(items: FavoriteChannel[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* favorites just won't survive a restart */
  }
}

interface ChannelFavoritesState {
  items: FavoriteChannel[];
  toggle: (playlistId: string, channel: Channel) => void;
  remove: (playlistId: string, channelId: string) => void;
  /** Swaps a stored channel for its current version from a freshly loaded playlist, in place. */
  relink: (playlistId: string, oldChannelId: string, channel: Channel) => void;
}

/** Same standalone-store shape as `store/favorites.ts` (movies) — persisted data, not
 *  navigation/UI state. A channel's own `id` is only unique within its playlist, so
 *  entries are keyed by (playlistId, channel.id) together. */
export const useChannelFavorites = create<ChannelFavoritesState>((set, get) => ({
  items: read(),
  toggle: (playlistId, channel) => {
    const { items } = get();
    const exists = items.some((f) => f.playlistId === playlistId && f.channel.id === channel.id);
    const next = exists
      ? items.filter((f) => !(f.playlistId === playlistId && f.channel.id === channel.id))
      : [{ playlistId, channel }, ...items];
    set({ items: next });
    write(next);
  },
  remove: (playlistId, channelId) => {
    const next = get().items.filter((f) => !(f.playlistId === playlistId && f.channel.id === channelId));
    set({ items: next });
    write(next);
  },
  relink: (playlistId, oldChannelId, channel) => {
    const next = get().items.map((f) => (f.playlistId === playlistId && f.channel.id === oldChannelId ? { playlistId, channel } : f));
    set({ items: next });
    write(next);
  },
}));
