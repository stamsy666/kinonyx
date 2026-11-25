import { useState, type ReactNode } from "react";
import type { PlayerStats } from "@kinonyx/player-core";
import { Focusable, Spinner } from "@kinonyx/ui";
import { KxAlert } from "./PlayerIcons";

/** A round control of the player: 64 px, a bare icon over the picture; white when it has the focus. */
export function KxButton({
  focusKey,
  label,
  onPress,
  children,
  large,
  active,
  plate,
  on,
  autoFocus,
  back,
}: {
  focusKey: string;
  /** What the button does — read by screen readers and shown by the mouse's tooltip. */
  label: string;
  onPress: () => void;
  children: ReactNode;
  /** The centre play/pause: 96 px with a ring. */
  large?: boolean;
  /** Its window or level is open. */
  active?: boolean;
  /** Drawn on a dark plate (the back arrow over a bright sky). */
  plate?: boolean;
  /** Switched on (a channel in the favourites). */
  on?: boolean;
  autoFocus?: boolean;
  back?: boolean;
}) {
  const cls = ["kx-btn", large && "kx-btn--lg", active && "kx-btn--active", plate && "kx-btn--plate", on && "kx-btn--on"].filter(Boolean).join(" ");
  return (
    <Focusable as="button" className={cls} focusKey={focusKey} onPress={onPress} autoFocus={autoFocus} back={back} scroll={false}>
      <span className="kx-btn__icon" aria-label={label} title={label}>
        {children}
      </span>
    </Focusable>
  );
}

/** A text button in a capsule (Пропустить титры, В эфир, Смотреть сейчас…). */
export function KxPill({
  focusKey,
  onPress,
  children,
  icon,
  variant = "ghost",
  dot,
  autoFocus,
}: {
  focusKey: string;
  onPress: () => void;
  children: ReactNode;
  icon?: ReactNode;
  /** ghost: bare words over the picture; solid: on a dark plate. */
  variant?: "ghost" | "solid";
  /** The red dot of LIVE before the words (В эфир). */
  dot?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <Focusable as="button" className={`kx-pill kx-pill--${variant}`} focusKey={focusKey} onPress={onPress} autoFocus={autoFocus} scroll={false}>
      {dot && <i className="kx-pill__dot" />}
      {icon}
      <span>{children}</span>
    </Focusable>
  );
}

/** The title block at the lower left: a small line above, the name, and a line of facts under it. */
export function KxLockup({ logo, eyebrow, aboveTitle, title, meta, metaMuted }: { logo?: ReactNode; eyebrow?: string; aboveTitle?: ReactNode; title: string; meta?: ReactNode; metaMuted?: boolean }) {
  return (
    <div className="kx-lockup">
      {logo}
      <div className="kx-lockup__text">
        {eyebrow && <p className="kx-eyebrow">{eyebrow}</p>}
        {aboveTitle}
        <h2 className="kx-title" title={title}>
          {title}
        </h2>
        {meta && <p className={`kx-meta ${metaMuted ? "kx-meta--muted" : ""}`}>{meta}</p>}
      </div>
    </div>
  );
}

function initialsOf(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

/** The channel's logo on a light plate (logos are drawn for light backgrounds); its initials when it has none. */
export function KxChannelLogo({ src, fallbackSrc, name, lazy }: { src?: string; fallbackSrc?: string; name: string; lazy?: boolean }) {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const image = [src, fallbackSrc].find((url) => url && !failedSources.includes(url));
  return (
    <span className="kx-logo">
      {image ? (
        <img key={image} src={image} alt="" loading={lazy ? "lazy" : "eager"} decoding="async"
          onError={() => setFailedSources((failed) => [...failed, image])} />
      ) : (
        <span className="kx-logo__initials">{initialsOf(name)}</span>
      )}
    </span>
  );
}

/** Connecting / buffering / preparing the translation: a capsule in the middle of the picture. */
export function KxWait({ text }: { text: string }) {
  return (
    <div className="kx-center" role="status">
      <div className="kx-wait">
        <Spinner />
        <span>{text}</span>
      </div>
    </div>
  );
}

/** A failure: a card in the middle with what happened and what can be done. */
export function KxError({ title, hint, children }: { title: string; hint: string; children?: ReactNode }) {
  return (
    <div className="kx-center kx-center--error">
      <div className="kx-card kx-card--error" role="alert">
        <KxAlert className="kx-card__icon" size={56} />
        <p className="kx-card__title">{title}</p>
        <p className="kx-card__hint">{hint}</p>
        {children && <div className="kx-card__actions">{children}</div>}
      </div>
    </div>
  );
}

/** «Статистика потока» (Settings → Плеер): a quiet panel at the left edge. */
export function KxStreamStats({ stats, bufferedAhead, extra }: { stats: PlayerStats; bufferedAhead: number; extra?: [string, string][] }) {
  const codec = [stats.videoCodec, stats.audioCodec].filter(Boolean).join(" / ");
  const rows: [string, string][] = [
    ["Разрешение", stats.width && stats.height ? `${stats.width}×${stats.height}` : "—"],
    ["FPS", stats.fps != null ? String(stats.fps) : "—"],
    ["Битрейт", stats.bitrateKbps ? `${(stats.bitrateKbps / 1000).toFixed(1)} Мбит/с` : "—"],
    ["Кодек", codec || "—"],
    ["Буфер", `${bufferedAhead.toFixed(1)} с`],
    ["Потеряно кадров", stats.droppedFrames != null ? String(stats.droppedFrames) : "—"],
    ...(extra ?? []),
  ];
  return (
    <div className="kx-stats">
      <p className="kx-stats__title">Статистика потока</p>
      {rows.map(([label, value]) => (
        <div className="kx-stats__row" key={label}>
          <span>{label}</span>
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

/** "1:02:07" / "4:05" — the time of a film. */
export function fmtTime(sec: number) {
  if (!Number.isFinite(sec)) return "--:--";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
