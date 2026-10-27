import { create } from "zustand";

const KEY = "kinonyx.notices";
const MAX = 60;

export type NoticeKind = "episode" | "download" | "update" | "info";

/** One line of the bell: what happened, when, and where pressing it leads. */
export interface Notice {
  id: string;
  kind: NoticeKind;
  title: string;
  text?: string;
  at: number;
  read: boolean;
  /** Pressing opens this film's page. */
  filmId?: number;
  poster?: string;
  /** Or one of the program's own places. */
  goto?: "downloads" | "settings";
}

function read(): Notice[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Notice[];
  } catch {
    /* falls through to empty */
  }
  return [];
}

function write(items: Notice[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* the list just is not remembered */
  }
}

interface NoticesState {
  items: Notice[];
  /** Adds a notice; one with the same id is not added twice (an episode is announced once). */
  add: (n: Omit<Notice, "at" | "read"> & { at?: number }) => void;
  markAllRead: () => void;
  clear: () => void;
}

export const useNotices = create<NoticesState>((set, get) => ({
  items: read(),
  add(n) {
    if (get().items.some((x) => x.id === n.id)) return;
    const items = [{ ...n, at: n.at ?? Date.now(), read: false }, ...get().items].slice(0, MAX);
    set({ items });
    write(items);
  },
  markAllRead() {
    const items = get().items.map((x) => (x.read ? x : { ...x, read: true }));
    set({ items });
    write(items);
  },
  clear() {
    set({ items: [] });
    write([]);
  },
}));

export const unreadCount = (items: Notice[]) => items.filter((n) => !n.read).length;
