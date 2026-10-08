import { useState } from "react";
import { Focusable } from "@kinonyx/ui";
import type { KpCollectionItem } from "../data/api";
import { img } from "../data/images";
import noPoster from "../assets/no-poster.jpg";

interface Props {
  film: KpCollectionItem;
  focusKey: string;
  onPress: () => void;
  /** Place in a top list — drawn as a big outlined number over the poster. */
  rank?: number;
  /** 0–1 — a thin bar across the bottom of the poster, "continue watching" style. */
  progress?: number;
  autoFocus?: boolean;
}

export function MovieCard({ film, focusKey, onPress, rank, progress, autoFocus }: Props) {
  const title = film.nameRu || film.nameOriginal || "Без названия";
  const poster = img(film.posterUrlPreview);
  // A `posterUrlPreview` field being set doesn't mean the file actually loads — brand new
  // or unreleased titles on Kinopoisk regularly point at a URL that 404s. Falls back to
  // the "no cover" placeholder instead of a broken-image icon.
  const [broken, setBroken] = useState(false);
  return (
    <Focusable focusKey={focusKey} className="movie-card" onPress={onPress} autoFocus={autoFocus}>
      <div className="movie-card__poster">
        {poster && !broken ? (
          <img src={poster} alt={title} loading="lazy" decoding="async" onError={() => setBroken(true)} />
        ) : (
          <img src={noPoster} alt={title} loading="lazy" decoding="async" />
        )}
        <span className="movie-card__play" aria-hidden="true">
          {/* Outline triangle that draws itself on focus (stroke-dash in theme.css). */}
          <svg width="64" height="64" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 6l10 6l-10 6Z" />
          </svg>
        </span>
        {rank != null && <span className="movie-card__rank">{rank}</span>}
        {progress != null && (
          <div className="movie-card__progress">
            <i style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="movie-card__title">{title}</div>
      <div className="movie-card__meta">
        {film.year ?? ""}
        {film.ratingKinopoisk ? ` · ★ ${film.ratingKinopoisk.toFixed(1)}` : ""}
      </div>
    </Focusable>
  );
}
