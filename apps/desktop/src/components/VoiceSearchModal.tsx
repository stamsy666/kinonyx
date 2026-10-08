import { useEffect, useRef, useState } from "react";
import { Focusable, MicIcon } from "@kinonyx/ui";
import { VoiceOrb } from "./VoiceOrb";
import { Modal } from "./Modal";
import { isTauri } from "../data/io";
import { useTranslator } from "../store/translator";
import { translatorTranscribe } from "../data/translator";
import { recordUntilSilence, type Recording } from "../data/voiceInput";
import { holdMusic } from "../data/music";

type Phase = "starting" | "listening" | "thinking" | "error";

/**
 * Voice search window: opens centred over a blurred page and listens until the viewer presses
 * the microphone inside it (no silence cut-off — they decide when they're done), then
 * recognises the speech with the local Whisper and hands the text back.
 */
export function VoiceSearchModal({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
  /** What the viewer is asked to name: "фильма или сериала", "канала". */
  subject?: string; // no longer shown (the hint was removed); callers may still pass it
}) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [message, setMessage] = useState("");
  // Voice level for the orb — a ref, written ~25×/s by the recorder, so no re-render per chunk.
  const level = useRef(0);
  const recording = useRef<Recording | null>(null);
  const alive = useRef(true);

  // The microphone must hear the viewer, not the background music: it fades out while this
  // window is open and fades back in when it closes.
  useEffect(() => holdMusic(), []);

  const begin = async () => {
    setMessage("");
    setPhase("starting");
    if (!isTauri) return fail("Голосовой поиск работает в приложении для ПК.");
    await useTranslator.getState().refresh();
    const tr = useTranslator.getState();
    if (!tr.asrEnabled) return fail("Распознавание речи выключено — включите его в Настройки → Каналы → Локальный перевод.");
    if (!tr.asrReady()) return fail("Нужна модель распознавания речи — скачайте её в Настройки → Каналы → Локальный перевод.");
    try {
      // Stops by itself once the speaker goes quiet; pressing the orb ends it earlier.
      const rec = await recordUntilSilence((rms) => (level.current = Math.min(1, rms * 12)));
      if (!alive.current) return rec.stop(false);
      recording.current = rec;
      setPhase("listening");
      const pcm = await rec.done;
      recording.current = null;
      if (!alive.current) return;
      if (!pcm) return fail("Ничего не расслышал — нажмите на микрофон и скажите название ещё раз.");
      setPhase("thinking");
      const text = await translatorTranscribe(tr.asrModel, pcm);
      if (!alive.current) return;
      if (!text) return fail("Не удалось разобрать речь — попробуйте ещё раз.");
      onResult(text);
    } catch (e) {
      recording.current = null;
      fail(e instanceof Error ? e.message : String(e));
    }
  };

  const fail = (text: string) => {
    if (!alive.current) return;
    setMessage(text);
    setPhase("error");
  };

  useEffect(() => {
    alive.current = true;
    void begin();
    return () => {
      alive.current = false;
      recording.current?.stop(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const press = () => {
    if (phase === "listening") recording.current?.stop(true);
    else if (phase === "error") void begin();
  };

  const title =
    phase === "listening" ? "Слушаю…" : phase === "thinking" ? "Распознаю…" : phase === "error" ? "Не получилось" : "Включаю микрофон…";
  const hint =
    phase === "error" ? message : "";

  return (
    <Modal focusKey="voice-modal" preferredChildFocusKey="voice:cancel" className="voice-modal" onClose={onClose}>
      <div className="voice-modal__body">
        <div className="voice-modal__title">{title}</div>
        {/* The orb IS the button: pressing it stops the recording (or retries after an error). */}
        <Focusable
          as="button"
          className={`voice-modal__orb voice-modal__orb--${phase}`}
          focusKey="voice:mic"
          scroll={false}
          onPress={press}
        >
          <VoiceOrb level={level} mode={phase === "listening" ? "listening" : phase === "thinking" ? "thinking" : "idle"} />
          {(phase === "listening" || phase === "error") && <MicIcon size={38} />}
        </Focusable>
        <div className="voice-modal__hint">{hint}</div>
        <Focusable as="button" className="btn" focusKey="voice:cancel" autoFocus scroll={false} onPress={onClose}>
          Отмена
        </Focusable>
      </div>
    </Modal>
  );
}
