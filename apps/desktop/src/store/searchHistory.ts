import { create } from "zustand";

const KEY = "kinonyx.searchHistory";
const MAX = 8;

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) return parsed.filter((q): q is string => typeof q === "string").slice(0, MAX);
  } catch {
    /* falls through to empty */
  }
  return [];
}

function write(items: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* history just won't survive a restart */
  }
}

interface SearchHistoryState {
  items: string[];
  add: (query: string) => void;
  clear: () => void;
}

/** Last few queries, newest first, no duplicates (case-insensitive). Recorded when a search
 *  is submitted or a result is opened — not per keystroke, which would fill it with "д", "дю". */
export const useSearchHistory = create<SearchHistoryState>((set, get) => ({
  items: read(),
  add: (query) => {
    const q = query.trim();
    if (q.length < 2) return;
    const next = [q, ...get().items.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX);
    set({ items: next });
    write(next);
  },
  clear: () => {
    set({ items: [] });
    write([]);
  },
}));
