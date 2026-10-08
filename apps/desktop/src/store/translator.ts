import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  onDownload,
  translatorCancelDownload,
  translatorDelete,
  translatorDownload,
  translatorRelease,
  translatorStatus,
  type DownloadEvent,
  type TranslatorItem,
} from "../data/translator";

interface Progress {
  received: number;
  total: number;
  stage?: string;
  error?: string;
}

interface TranslatorState {
  // Persisted choices
  asrModel: string;
  mtModel: string;
  /** Seconds the broadcast runs behind the live edge while translating. */
  delay: number;
  sourceLang: string | null;
  /** Settings switches — an installed component can be switched off without deleting it.
   *  Recognition and translation are one pipeline: either off means no translation. */
  asrEnabled: boolean;
  mtEnabled: boolean;
  voiceEnabled: boolean;

  // Runtime
  /** Translated subtitles switched on in the player — stays on while zapping. */
  active: boolean;
  /** Voice-over switched on in the player (independent of the subtitles). */
  voiceActive: boolean;
  items: TranslatorItem[];
  root: string;
  bundled: boolean;
  vramMb: number | null;
  progress: Record<string, Progress>;

  setActive(on: boolean): void;
  setVoiceActive(on: boolean): void;
  setAsrModel(id: string): void;
  setMtModel(id: string): void;
  setDelay(s: number): void;
  setSourceLang(code: string | null): void;
  setAsrEnabled(on: boolean): void;
  setMtEnabled(on: boolean): void;
  setVoiceEnabled(on: boolean): void;
  /** Both halves of the translation pipeline are switched on in settings. */
  translationEnabled(): boolean;
  refresh(): Promise<void>;
  download(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  remove(id: string): Promise<string | null>;
  /** Everything needed for the currently selected models is on disk. */
  ready(): boolean;
  /** …and the voice-over runtime and model too. */
  voiceReady(): boolean;
  /** Speech recognition alone is usable (voice search needs no translation model). */
  asrReady(): boolean;
}

let listening = false;

export const useTranslator = create<TranslatorState>()(
  persist(
    (set, get) => ({
      asrModel: "whisper-large-v3-turbo",
      mtModel: "hymt2-q8",
      delay: 20,
      sourceLang: null,
      asrEnabled: true,
      mtEnabled: true,
      voiceEnabled: true,
      active: false,
      voiceActive: false,
      items: [],
      root: "",
      bundled: false,
      vramMb: null,
      progress: {},

      setActive: (active) => set({ active }),
      setVoiceActive: (voiceActive) => set({ voiceActive }),
      setAsrModel: (asrModel) => set({ asrModel }),
      setMtModel: (mtModel) => set({ mtModel }),
      setDelay: (delay) => set({ delay }),
      setSourceLang: (sourceLang) => set({ sourceLang }),
      // Switching a component off also stops whatever was using it right now — a player
      // left running with the translator on would otherwise keep the models loaded.
      // …and kills the helper processes right away: with everything switched off the only
      // KINONYX process left is KINONYX itself. (Switched ON they stay absent until a channel
      // actually turns the feature on.)
      setAsrEnabled: (asrEnabled) => {
        set(asrEnabled ? { asrEnabled } : { asrEnabled, active: false, voiceActive: false });
        if (!asrEnabled) void translatorRelease("all").catch(() => undefined);
      },
      setMtEnabled: (mtEnabled) => {
        set(mtEnabled ? { mtEnabled } : { mtEnabled, active: false, voiceActive: false });
        if (!mtEnabled) void translatorRelease("all").catch(() => undefined);
      },
      setVoiceEnabled: (voiceEnabled) => {
        set(voiceEnabled ? { voiceEnabled } : { voiceEnabled, voiceActive: false });
        if (!voiceEnabled) void translatorRelease(get().active ? "voice" : "all").catch(() => undefined);
      },
      translationEnabled: () => get().asrEnabled && get().mtEnabled,

      async refresh() {
        if (!listening) {
          listening = true;
          void onDownload((e: DownloadEvent) => {
            set((s) => {
              const progress = { ...s.progress };
              if (e.state === "progress") progress[e.id] = { received: e.received, total: e.total, stage: e.stage };
              else if (e.state === "error") progress[e.id] = { received: 0, total: e.total, error: e.error };
              else delete progress[e.id];
              return { progress };
            });
            if (e.state !== "progress") void get().refresh();
          });
        }
        const st = await translatorStatus().catch(() => null);
        if (st) set({ items: st.items, root: st.root, bundled: st.bundled, vramMb: st.vramMb });
      },

      async download(id) {
        set((s) => ({ progress: { ...s.progress, [id]: { received: 0, total: s.items.find((i) => i.id === id)?.size ?? 0 } } }));
        await translatorDownload(id);
        void get().refresh();
      },

      async cancel(id) {
        await translatorCancelDownload(id);
      },

      async remove(id) {
        try {
          await translatorDelete(id);
          await get().refresh();
          return null;
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      },

      ready() {
        const { items, asrModel, mtModel, bundled } = get();
        const ok = (id: string) => items.some((i) => i.id === id && i.installed);
        return get().translationEnabled() && bundled && ok("engine-cuda") && ok(asrModel) && ok(mtModel);
      },

      asrReady() {
        const { items, asrModel, bundled, asrEnabled } = get();
        const ok = (id: string) => items.some((i) => i.id === id && i.installed);
        return asrEnabled && bundled && ok("engine-cuda") && ok(asrModel);
      },

      voiceReady() {
        const ok = (id: string) => get().items.some((i) => i.id === id && i.installed);
        return get().voiceEnabled && get().ready() && ok("voice-runtime") && ok("voice-omnivoice");
      },
    }),
    {
      name: "kinonyx.translator",
      partialize: (s) => ({
        asrModel: s.asrModel,
        mtModel: s.mtModel,
        delay: s.delay,
        sourceLang: s.sourceLang,
        asrEnabled: s.asrEnabled,
        mtEnabled: s.mtEnabled,
        voiceEnabled: s.voiceEnabled,
      }),
    },
  ),
);
