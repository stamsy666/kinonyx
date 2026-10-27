import { useEffect, useState, type MutableRefObject } from "react";
import { Focusable } from "@kinonyx/ui";
import type { PlayerAdapter } from "@kinonyx/player-core";
import { ASPECT_LABELS, ASPECT_MODES, useApp, type PlayerPrefs } from "../store/app";
import { liveMpvOptions } from "../data/playerOptions";
import { Modal } from "./Modal";

/**
 * The "Картинка" window of the mpv players (films and channels): picture shape, HDR, sharpness, banding. A change
 * goes to mpv at once and is kept in the settings (Настройки → Плеер), so the next video starts the same way.
 */
export function PicturePanel({ adapterRef, onClose }: { adapterRef: MutableRefObject<PlayerAdapter | null>; onClose: () => void }) {
  const prefs = useApp((s) => s.playerPrefs);
  const setPlayerPrefs = useApp((s) => s.setPlayerPrefs);
  const [info, setInfo] = useState("");

  // What the video really is and what is being sent to the display (HDR or SDR).
  const refreshInfo = async () => {
    const a = adapterRef.current;
    if (!a?.getProp) return;
    const [gamma, prim, outGamma] = await Promise.all([
      a.getProp("video-params/gamma"),
      a.getProp("video-params/primaries"),
      a.getProp("video-target-params/gamma"),
    ]);
    const src = gamma === "pq" ? "HDR10" : gamma === "hlg" ? "HLG (HDR)" : "SDR";
    const out = outGamma === "pq" || outGamma === "hlg" ? "HDR" : "SDR";
    setInfo(`Видео: ${src}${prim ? ` · ${prim}` : ""}. На экран идёт: ${out}.`);
  };
  useEffect(() => {
    void refreshInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (patch: Partial<PlayerPrefs>) => {
    const next = { ...prefs, ...patch };
    setPlayerPrefs(patch);
    const a = adapterRef.current;
    if (a?.setProp) for (const [k, v] of Object.entries(liveMpvOptions(next))) void a.setProp(k, v);
    window.setTimeout(() => void refreshInfo(), 600);
  };

  return (
    <Modal focusKey="player:picture" preferredChildFocusKey="pic:aspect" className="links-tv" onClose={onClose}>
      <h3 className="links-tv__title">Картинка</h3>
      {info && <p className="links-tv__text">{info}</p>}
      <div className="links-tv__list links-tv__scroll">
        <Row
          focusKey="pic:aspect"
          label="Соотношение сторон"
          hint={ASPECT_LABELS[prefs.aspect]}
          active={prefs.aspect !== "auto"}
          autoFocus
          onPress={() => change({ aspect: ASPECT_MODES[(ASPECT_MODES.indexOf(prefs.aspect) + 1) % ASPECT_MODES.length] })}
        />
        <Row
          focusKey="pic:hdr"
          label="HDR-вывод на экран"
          hint={prefs.hdrOutput ? "Включён" : "Выключен"}
          active={prefs.hdrOutput}
          onPress={() => change({ hdrOutput: !prefs.hdrOutput })}
        />
        <Row
          focusKey="pic:tone"
          label="HDR на обычном экране"
          hint={prefs.toneMapping === "auto" ? "Авто" : prefs.toneMapping === "soft" ? "Мягкий" : "Контрастный"}
          active={prefs.toneMapping !== "auto"}
          onPress={() => change({ toneMapping: prefs.toneMapping === "auto" ? "soft" : prefs.toneMapping === "soft" ? "contrast" : "auto" })}
        />
        <Row
          focusKey="pic:sharp"
          label="Чёткость"
          hint={prefs.upscale === "default" ? "Обычная" : prefs.upscale === "sharp" ? "Повышенная" : "Максимум"}
          active={prefs.upscale !== "default"}
          onPress={() => change({ upscale: prefs.upscale === "default" ? "sharp" : prefs.upscale === "sharp" ? "max" : "default" })}
        />
        <Row
          focusKey="pic:deband"
          label="Сглаживать полосы"
          hint={prefs.deband ? "Включено" : "Выключено"}
          active={prefs.deband}
          onPress={() => change({ deband: !prefs.deband })}
        />
        <Row
          focusKey="pic:smooth"
          label="Плавность движения"
          hint={prefs.smooth ? "Включена" : "Выключена"}
          active={prefs.smooth}
          onPress={() => change({ smooth: !prefs.smooth })}
        />
      </div>
      <p className="links-tv__text links-tv__text--small">
        Нажатие листает значения. HDR-вывод работает, если в Windows включён HDR для этого экрана; если картинка стала странной, выключите.
      </p>
      <Focusable as="button" back focusKey="pic:close" className="links-tv__row links-tv__row--close links-tv__foot" scroll={false} onPress={onClose}>
        <span className="links-tv__name">Закрыть</span>
      </Focusable>
    </Modal>
  );
}

function Row({ focusKey, label, hint, active, autoFocus, onPress }: { focusKey: string; label: string; hint: string; active: boolean; autoFocus?: boolean; onPress: () => void }) {
  return (
    <Focusable as="button" className={`links-tv__row ${active ? "is-active" : ""}`} focusKey={focusKey} onPress={onPress} autoFocus={autoFocus} scroll={false}>
      <span className="links-tv__name">{label}</span>
      <span className="links-tv__hint">{hint}</span>
    </Focusable>
  );
}
