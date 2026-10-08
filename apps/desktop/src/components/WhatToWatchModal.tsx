import { useEffect, useState } from "react";
import { BackIcon, Focusable, FocusGroup, NextIcon, Spinner } from "@kinonyx/ui";
import { kpFilmsFilter, kpGenres, type KpCollectionItem } from "../data/api";
import { img } from "../data/images";
import { ProgressiveImg } from "./ProgressiveImg";
import { Modal } from "./Modal";
import { PopcornIcon } from "./AnimatedIcons";

type Step = "mood" | "confidence" | "loading" | "results" | "empty";

const normalizeGenre = (s: string) => s.trim().toLowerCase();

// Genre *names*, not ids — the numeric ids are source-specific (Kinopoisk's and TMDB's
// don't agree, e.g. Kinopoisk's 13/17/2/7 used to be hardcoded here for комедия/ужасы/
// драма/приключения, which on TMDB happened to mean nothing or the wrong genre, so
// switching the metadata source to TMDB made this quiz always come back empty). Resolved
// to whichever source's own id via `kpGenres()` at pick time — same pattern MovieScreen's
// genre chips already use.
const MOODS: { key: string; label: string; genreName: string }[] = [
  { key: "laugh", label: "Посмеяться", genreName: "комедия" },
  { key: "fear", label: "Испугаться", genreName: "ужасы" },
  { key: "feel", label: "Попереживать", genreName: "драма" },
  { key: "chill", label: "Просто отдохнуть", genreName: "приключения" },
];

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * A tiny quiz instead of a search box: two taps (mood, then how safe a bet you want)
 * narrow the whole catalog down to a genre+rating filter, and the results come back as
 * one card at a time — flip left/right through the shuffled shortlist instead of facing
 * a grid, which is the actual point ("проще выбрать" than scrolling a shelf yourself).
 */
export function WhatToWatchModal({ onClose, onOpenFilm }: { onClose: () => void; onOpenFilm: (film: KpCollectionItem) => void }) {
  const [step, setStep] = useState<Step>("mood");
  const [genre, setGenre] = useState<number | null>(null);
  const [results, setResults] = useState<KpCollectionItem[]>([]);
  const [index, setIndex] = useState(0);
  const [genreIds, setGenreIds] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    kpGenres()
      .then((r) => !cancelled && setGenreIds(new Map(r.genres.map((g) => [normalizeGenre(g.genre), g.id]))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const pickMood = (name: string) => {
    const id = genreIds?.get(normalizeGenre(name));
    if (id == null) {
      setStep("empty");
      return;
    }
    setGenre(id);
    setStep("confidence");
  };

  const pickConfidence = (ratingFrom: number) => {
    if (genre == null) return;
    setStep("loading");
    kpFilmsFilter({ kind: "FILM", genre, ratingFrom, order: "NUM_VOTE" }, 1)
      .then((r) => {
        const items = shuffled((r.items ?? []).filter((f) => f.posterUrlPreview)).slice(0, 10);
        if (items.length === 0) {
          setStep("empty");
          return;
        }
        setResults(items);
        setIndex(0);
        setStep("results");
      })
      .catch(() => setStep("empty"));
  };

  const restart = () => {
    setStep("mood");
    setGenre(null);
    setResults([]);
    setIndex(0);
  };

  const current = results[index];
  const go = (delta: number) => setIndex((i) => (i + delta + results.length) % results.length);

  return (
    <Modal focusKey="what-to-watch" preferredChildFocusKey="wtw:0" onClose={onClose} className="wtw">
      <div className="modal-panel__header">
        <h3>
          <PopcornIcon size={22} auto /> Что посмотреть?
        </h3>
        <Focusable back as="button" className="icon-btn" focusKey="wtw:close" onPress={onClose} scroll={false}>
          ×
        </Focusable>
      </div>

      {step === "mood" && (
        <FocusGroup focusKey="wtw:moods" className="wtw__grid" preferredChildFocusKey="wtw:0">
          <p className="wtw__prompt">Какое настроение?</p>
          <div className="wtw__options">
            {MOODS.map((m, i) => (
              <Focusable
                key={m.key}
                as="button"
                className="wtw__option"
                focusKey={`wtw:${i}`}
                autoFocus={i === 0}
                onPress={() => pickMood(m.genreName)}
                scroll={false}
              >
                {m.label}
              </Focusable>
            ))}
          </div>
        </FocusGroup>
      )}

      {step === "confidence" && (
        <FocusGroup focusKey="wtw:confidence" className="wtw__grid" preferredChildFocusKey="wtw:safe">
          <p className="wtw__prompt">Точно понравится, или можно рискнуть?</p>
          <div className="wtw__options">
            <Focusable as="button" className="wtw__option" focusKey="wtw:safe" autoFocus onPress={() => pickConfidence(7.5)} scroll={false}>
              Точно понравится
            </Focusable>
            <Focusable as="button" className="wtw__option" focusKey="wtw:risk" onPress={() => pickConfidence(0)} scroll={false}>
              Можно рискнуть
            </Focusable>
          </div>
        </FocusGroup>
      )}

      {step === "loading" && (
        <div style={{ display: "grid", placeItems: "center", padding: "50px 0", gap: 14 }}>
          <Spinner />
          <span className="modal-status">Подбираю…</span>
        </div>
      )}

      {step === "empty" && (
        <div className="stack" style={{ gap: 14, padding: "30px 0", alignItems: "center" }}>
          <p className="empty">Ничего подходящего не нашлось.</p>
          <Focusable as="button" className="btn" focusKey="wtw:retry" autoFocus onPress={restart} scroll={false}>
            Попробовать ещё раз
          </Focusable>
        </div>
      )}

      {step === "results" && current && (
        <FocusGroup focusKey="wtw:result" className="wtw__result" preferredChildFocusKey="wtw:open">
          <div className="wtw__result-poster">
            <ProgressiveImg src={img(current.posterUrl)} placeholder={img(current.posterUrlPreview)} alt="" />
          </div>
          <div className="wtw__result-info">
            {current.ratingKinopoisk != null && <span className="movie-head__rating">★ {current.ratingKinopoisk.toFixed(1)}</span>}
            <h4>{current.nameRu || current.nameOriginal}</h4>
            <p className="wtw__result-desc">{current.description}</p>
            <div className="row">
              <Focusable as="button" className="icon-btn" focusKey="wtw:prev" onPress={() => go(-1)} scroll={false}>
                <BackIcon />
              </Focusable>
              <Focusable
                as="button"
                className="btn btn--primary"
                focusKey="wtw:open"
                autoFocus
                onPress={() => onOpenFilm(current)}
                scroll={false}
              >
                Открыть
              </Focusable>
              <Focusable as="button" className="icon-btn" focusKey="wtw:next" onPress={() => go(1)} scroll={false}>
                <NextIcon />
              </Focusable>
              <Focusable as="button" className="btn" focusKey="wtw:restart" onPress={restart} scroll={false}>
                Начать заново
              </Focusable>
            </div>
          </div>
        </FocusGroup>
      )}
    </Modal>
  );
}
