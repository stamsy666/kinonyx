import { isTauri } from "./io";

/** Local live-TV translator (Rust side: src-tauri/src/translator). Desktop build only. */

export type TranslatorKind = "engine" | "asr" | "mt" | "voice";

export interface TranslatorItem {
  id: string;
  kind: TranslatorKind;
  title: string;
  note: string;
  size: number;
  installed: boolean;
  downloading: boolean;
}

export interface TranslatorStatus {
  root: string;
  items: TranslatorItem[];
  bundled: boolean;
  /** Video memory of the NVIDIA card, MiB. */
  vramMb: number | null;
}

export interface DownloadEvent {
  id: string;
  received: number;
  total: number;
  state: "progress" | "done" | "error" | "cancelled";
  /** Current step of a multi-step install (the voice runtime). */
  stage?: string;
  error?: string;
}

export interface Cue {
  session: number;
  start: number;
  end: number;
  text: string;
  orig: string;
}

export interface SessionStatus {
  session: number;
  state: "starting" | "ready" | "error" | "stalled" | "voice-starting" | "voice-ready" | "voice-error";
  message?: string;
}

export interface StartOptions {
  url: string;
  asrModel: string;
  mtModel: string;
  sourceLang: string | null;
  voice: boolean;
}

/** A translated sentence spoken in the original voice, to play at `start` (player time). */
export interface VoiceClip {
  session: number;
  start: number;
  end: number;
  /** WAV, base64. */
  audio: string;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error("Локальный перевод работает только в приложении для ПК");
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

async function listen<T>(event: string, fn: (payload: T) => void): Promise<() => void> {
  if (!isTauri) return () => undefined;
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  return tauriListen<T>(event, (e) => fn(e.payload));
}

export const translatorStatus = () =>
  isTauri
    ? invoke<TranslatorStatus>("translator_status")
    : Promise.resolve<TranslatorStatus>({ root: "", items: [], bundled: false, vramMb: null });
export const translatorDownload = (id: string) => invoke<void>("translator_download", { id });
export const translatorCancelDownload = (id: string) => invoke<void>("translator_cancel_download", { id });
export const translatorDelete = (id: string) => invoke<void>("translator_delete", { id });
export const translatorStart = (options: StartOptions) => invoke<{ session: number; playUrl: string }>("translator_start", { options });
export const translatorStop = (session?: number) => invoke<void>("translator_stop", { session: session ?? null });
/** "voice" kills just the voice-over server, "all" every helper process, immediately. */
export const translatorRelease = (what: "voice" | "all") => invoke<void>("translator_release", { what });
export const translatorPosition = (session: number, position: number) => invoke<void>("translator_position", { session, position });
export const translatorVoice = (session: number, on: boolean) => invoke<void>("translator_voice", { session, on });

export const onDownload = (fn: (e: DownloadEvent) => void) => listen<DownloadEvent>("translator://download", fn);
export const onCue = (fn: (c: Cue) => void) => listen<Cue>("translator://cue", fn);
export const onSessionStatus = (fn: (s: SessionStatus) => void) => listen<SessionStatus>("translator://status", fn);
export const onVoice = (fn: (c: VoiceClip) => void) => listen<VoiceClip>("translator://voice", fn);

export function formatSize(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1).replace(".", ",")} ГБ` : `${Math.round(bytes / 1e6)} МБ`;
}

/** Source-language choices: whisper auto-detects, but pinning it avoids misdetections on
 *  short or noisy stretches (the main cause of garbled, half-translated lines). */
export const SOURCE_LANGS: { code: string | null; label: string }[] = [
  { code: null, label: "Определять" },
  { code: "en", label: "Английский" },
  { code: "de", label: "Немецкий" },
  { code: "fr", label: "Французский" },
  { code: "es", label: "Испанский" },
  { code: "it", label: "Итальянский" },
  { code: "tr", label: "Турецкий" },
  { code: "uk", label: "Украинский" },
  { code: "pl", label: "Польский" },
  { code: "ja", label: "Японский" },
  { code: "ko", label: "Корейский" },
  { code: "zh", label: "Китайский" },
];

export const DELAY_OPTIONS = [10, 15, 20, 30];
