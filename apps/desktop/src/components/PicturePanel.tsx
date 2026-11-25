import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { FrameGeneration, PlayerAdapter } from "@kinonyx/player-core";
import { ASPECT_LABELS, ASPECT_MODES, DEFAULT_PLAYER_PREFS, useApp, type PlayerPrefs } from "../store/app";
import { DLSS_OPTIONS, liveMpvOptions } from "../data/playerOptions";
import { isTauri } from "../data/io";
import { KxSegmentRow, KxSheet, KxSheetButton } from "./player/PlayerSheet";
import { KxPicture } from "./player/PlayerIcons";

type AdapterRef = MutableRefObject<PlayerAdapter | null>;

/** What the video really is and what is being sent to the display (HDR or SDR), read from mpv. */
function usePictureInfo(adapterRef: AdapterRef) {
  const [info, setInfo] = useState<{ video: string; out: string } | null>(null);
  const refresh = async () => {
    const a = adapterRef.current;
    if (!a?.getProp) return;
    const [gamma, prim, outGamma] = await Promise.all([
      a.getProp("video-params/gamma"),
      a.getProp("video-params/primaries"),
      a.getProp("video-target-params/gamma"),
    ]);
    const src = gamma === "pq" ? "HDR10" : gamma === "hlg" ? "HLG (HDR)" : "SDR";
    setInfo({ video: prim ? `${src} · ${prim.toUpperCase()}` : src, out: outGamma === "pq" || outGamma === "hlg" ? "HDR" : "SDR" });
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { info, refresh };
}

/** «Видео → На экран»: the strip over the picture settings. */
export function PictureInfo({ info }: { info: { video: string; out: string } | null }) {
  if (!info) return null;
  return (
    <div className="kx-info">
      <span className="kx-info__part">
        <small>Видео</small>
        <b>{info.video}</b>
      </span>
      <span className="kx-info__arrow" aria-hidden="true">
        →
      </span>
      <span className="kx-info__part">
        <small>На экран</small>
        <b className={info.out === "HDR" ? "" : "kx-info__dim"}>{info.out}</b>
      </span>
    </div>
  );
}

const TONE = [
  { value: "auto", label: "Авто" },
  { value: "soft", label: "Мягкий" },
  { value: "contrast", label: "Контраст" },
] as const;
const SHARP = [
  { value: "default", label: "Обычная" },
  { value: "sharp", label: "Повышенная" },
  { value: "max", label: "Максимум" },
] as const;
const ON_OFF = [
  { value: false, label: "Выкл" },
  { value: true, label: "Вкл" },
];

/**
 * One way to change the picture: the new values go to the settings (kept for the next video) and to mpv at once.
 * `reset` puts back the defaults of «Картинка» only — subtitles, sound and the rest of the settings stay as they are.
 */
export function usePictureChange(adapterRef: AdapterRef, onInfo?: () => void) {
  const prefs = useApp((s) => s.playerPrefs);
  const setPlayerPrefs = useApp((s) => s.setPlayerPrefs);
  const change = (patch: Partial<PlayerPrefs>) => {
    const next = { ...prefs, ...patch };
    setPlayerPrefs(patch);
    const a = adapterRef.current;
    if (a?.setProp) for (const [k, v] of Object.entries(liveMpvOptions(next))) void a.setProp(k, v);
    if (onInfo) window.setTimeout(onInfo, 600);
  };
  const reset = () => {
    const { aspect, hdrOutput, toneMapping, upscale, deband, smooth } = DEFAULT_PLAYER_PREFS;
    change({ aspect, hdrOutput, toneMapping, upscale, deband, smooth, frameGeneration: 0 });
    void adapterRef.current?.setFrameGeneration?.(0).catch(() => {});
  };
  return { prefs, change, reset };
}

/** The foot of «Картинка»: «Сбросить» (the picture's defaults) and «Закрыть». */
export function PictureFooter({ adapterRef, onInfo, onClose, prefix }: { adapterRef: AdapterRef; onInfo?: () => void; onClose: () => void; prefix: string }) {
  const { reset } = usePictureChange(adapterRef, onInfo);
  return (
    <>
      <KxSheetButton focusKey={`${prefix}:reset`} onPress={reset}>
        Сбросить
      </KxSheetButton>
      <KxSheetButton focusKey={`${prefix}:close`} back onPress={onClose}>
        Закрыть
      </KxSheetButton>
    </>
  );
}

/**
 * The picture settings of the mpv players (films and channels): shape, HDR, sharpness, banding, smoothness. Every
 * value is in sight; ← / → change it, the change goes to mpv at once and is kept in the settings (Настройки →
 * Плеер), so the next video starts the same way.
 */
export function PictureSettings({ adapterRef, onInfo, autoFocus }: { adapterRef: AdapterRef; onInfo?: () => void; autoFocus?: boolean }) {
  const { prefs, change } = usePictureChange(adapterRef, onInfo);
  const save = useApp((s) => s.setPlayerPrefs);
  const [dlssNote, setDlssNote] = useState("");
  const changing = useRef(false);
  const changeDlss = async (factor: FrameGeneration) => {
    if (changing.current || !adapterRef.current?.setFrameGeneration) return;
    changing.current = true;
    setDlssNote("Переключение…");
    try {
      await adapterRef.current.setFrameGeneration(factor);
      save({ frameGeneration: factor });
      setDlssNote("");
    } catch (error) {
      setDlssNote(typeof error === "string" ? error : "Не удалось переключить DLSS");
    } finally {
      changing.current = false;
    }
  };

  return (
    <>
      <KxSegmentRow
        focusKey="pic:aspect"
        label="Соотношение сторон"
        options={ASPECT_MODES.map((m) => ({ value: m, label: m === "fill" ? "Заполнить" : ASPECT_LABELS[m] }))}
        value={prefs.aspect}
        onChange={(aspect) => change({ aspect })}
        autoFocus={autoFocus}
      />
      <KxSegmentRow
        focusKey="pic:hdr"
        label="HDR-вывод на экран"
        note="нужен HDR в Windows"
        options={ON_OFF}
        value={prefs.hdrOutput}
        onChange={(hdrOutput) => change({ hdrOutput })}
      />
      <KxSegmentRow
        focusKey="pic:tone"
        label="HDR на обычном экране"
        options={TONE.map((o) => ({ ...o }))}
        value={prefs.toneMapping}
        onChange={(toneMapping) => change({ toneMapping })}
      />
      <KxSegmentRow
        focusKey="pic:sharp"
        label="Чёткость"
        options={SHARP.map((o) => ({ ...o }))}
        value={prefs.upscale}
        onChange={(upscale) => change({ upscale })}
      />
      <KxSegmentRow focusKey="pic:deband" label="Сглаживать полосы" options={ON_OFF} value={prefs.deband} onChange={(deband) => change({ deband })} />
      <KxSegmentRow focusKey="pic:smooth" label="Плавность движения" options={ON_OFF} value={prefs.smooth} onChange={(smooth) => change({ smooth })} />
      {isTauri && (
        <KxSegmentRow
          focusKey="pic:dlss"
          label="DLSS Frame Generation"
          note={dlssNote || "SDR до 1080p"}
          options={DLSS_OPTIONS}
          value={prefs.frameGeneration}
          onChange={(factor) => void changeDlss(factor)}
        />
      )}
    </>
  );
}

/** «Картинка» on its own (the players open it as a tab of their settings window). */
export function PicturePanel({ adapterRef, onClose }: { adapterRef: AdapterRef; onClose: () => void }) {
  const { info, refresh } = usePictureInfo(adapterRef);
  return (
    <KxSheet
      focusKey="player:picture"
      preferredChildFocusKey="pic:aspect"
      title="Картинка"
      icon={<KxPicture />}
      top={<PictureInfo info={info} />}
      footer={<PictureFooter adapterRef={adapterRef} onInfo={() => void refresh()} onClose={onClose} prefix="player:picture" />}
      onClose={onClose}
    >
      <PictureSettings adapterRef={adapterRef} onInfo={() => void refresh()} autoFocus />
    </KxSheet>
  );
}

export { usePictureInfo };
