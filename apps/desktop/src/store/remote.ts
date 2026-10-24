import { create } from "zustand";
import { remoteInfo, remoteStart, remoteStop, type RemoteInfo } from "../data/remote";

const ENABLED_KEY = "kinonyx.remoteOn";
const TOKEN_KEY = "kinonyx.remoteToken";

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the choice just won't survive a restart */
  }
};

/** The secret in the QR code: made once and kept, so a phone that scanned it stays paired. */
function token(): string {
  const have = read(TOKEN_KEY);
  if (have && /^[A-Za-z0-9]{8,64}$/.test(have)) return have;
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const made = Array.from(bytes, (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
  write(TOKEN_KEY, made);
  return made;
}

interface RemoteState {
  enabled: boolean;
  info: RemoteInfo | null;
  error: string | null;
  setEnabled: (on: boolean) => Promise<void>;
  /** Called once at startup: brings the remote up again if it was left on. */
  resume: () => Promise<void>;
  /** A new secret: phones that scanned the old code are locked out. */
  renew: () => Promise<void>;
}

export const useRemote = create<RemoteState>((set, get) => ({
  enabled: read(ENABLED_KEY) === "1",
  info: null,
  error: null,

  async setEnabled(on) {
    write(ENABLED_KEY, on ? "1" : "0");
    set({ enabled: on, error: null });
    try {
      if (on) set({ info: await remoteStart(token()) });
      else {
        await remoteStop();
        set({ info: null });
      }
    } catch (e) {
      write(ENABLED_KEY, "0");
      set({ enabled: false, info: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  async resume() {
    if (!get().enabled) return;
    try {
      set({ info: await remoteStart(token()), error: null });
    } catch (e) {
      set({ enabled: false, info: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  async renew() {
    write(TOKEN_KEY, "");
    if (get().enabled) set({ info: await remoteStart(token()) });
  },
}));

/** The addresses may change with the network: read them again when the settings page is opened. */
export async function refreshRemoteInfo() {
  try {
    const info = await remoteInfo();
    if (info) useRemote.setState({ info });
  } catch {
    /* not running */
  }
}
