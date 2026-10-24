import { useEffect, useRef, useState } from "react";
import { BackIcon, Focusable, FocusGroup, NextIcon, PlayIcon, Spinner } from "@kinonyx/ui";
import { kpFilm, kpFilmsFilter, kpGenres, type KpCollectionItem } from "../data/api";
import { img } from "../data/images";
import { useContinueWatching } from "../store/continueWatching";
import { useFavorites } from "../store/favorites";
import { ProgressiveImg } from "./ProgressiveImg";
import { Modal } from "./Modal";

type Step = "mood" | "risk" | "loading" | "result" | "empty";

const normalizeGenre = (s: string) => s.trim().toLowerCase();

// Genre *names*, not ids: the numeric ids belong to a source (Kinopoisk's and TMDB's differ), so they are looked
// up through `kpGenres()` at pick time. A mood lists several names — the first one the source knows wins.
const MOODS: { key: string; label: string; genres: string[] }[] = [
  { key: "laugh", label: "Посмеяться", genres: ["комедия"] },
  { key: "feel", label: "Попереживать", genres: ["драма"] },
  { key: "fear", label: "Испугаться", genres: ["ужасы"] },
  { key: "thrill", label: "Адреналин", genres: ["боевик", "триллер"] },
  { key: "wonder", label: "Уйти в другой мир", genres: ["фантастика", "научная фантастика", "фэнтези"] },
  { key: "chill", label: "Просто отдохнуть", genres: ["приключения", "семейный"] },
  { key: "any", label: "Удиви меня", genres: [] },
];

// How safe a bet. Always sorted by the number of votes — a film with thousands of ratings is a proven one,
// not somebody's single 10/10. `pages` is how deep into that list a random page may be taken.
const RISKS: { key: string; label: string; hint: string; ratingFrom: number; pages: number }[] = [
  { key: "safe", label: "Точно понравится", hint: "рейтинг от 7.5", ratingFrom: 7.5, pages: 6 },
  { key: "good", label: "Хороший фильм", hint: "рейтинг от 6.8", ratingFrom: 6.8, pages: 10 },
  { key: "wild", label: "Рискнуть", hint: "рейтинг от 6", ratingFrom: 6, pages: 14 },
];

/** A real random number: the page and the film are drawn with the system's generator, not a seeded one. */
function randomBelow(n: number): number {
  if (n <= 1) return 0;
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// What was already suggested stays suggested once: remembered between launches, so the same film does not come
// back next week. The oldest are forgotten after a few hundred.
const SEEN_KEY = "kinonyx.wtwSeen";
const SEEN_MAX = 300;
function readSeen(): number[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw) return JSON.parse(raw) as number[];
  } catch {
    /* an empty list */
  }
  return [];
}
function rememberSeen(id: number) {
  try {
    const list = readSeen().filter((x) => x !== id);
    list.push(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-SEEN_MAX)));
  } catch {
    /* it will just be suggested again some day */
  }
}

/**
 * "What to watch?" — two taps (the mood, how safe a bet) and one film comes up, drawn at random from the most
 * voted films of that genre; "Другой фильм" draws the next. Nothing from the favourites, the films being watched
 * or the ones already suggested is offered.
 */
export function WhatToWatchModal({ onClose, onOpenFilm }: { onClose: () => void; onOpenFilm: (film: KpCollectionItem) => void }) {
  const [step, setStep] = useState<Step>("mood");
  const [film, setFilm] = useState<KpCollectionItem | null>(null);
  const [genreIds, setGenreIds] = useState<Map<string, number> | null>(null);
  const favorites = useFavorites((s) => s.items);
  const watching = useContinueWatching((s) => s.items);

  // The film pool of the current choice, and which random pages of it were already taken.
  const pool = useRef<KpCollectionItem[]>([]);
  const pagesLeft = useRef<number[]>([]);
  const criteria = useRef<{ genre?: number; ratingFrom: number; yearFrom?: number } | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    let cancelled = false;
    kpGenres()
      .then((r) => !cancelled && setGenreIds(new Map(r.genres.map((g) => [normalizeGenre(g.genre), g.id]))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const [mood, setMood] = useState<(typeof MOODS)[number] | null>(null);

  const excluded = () => {
    const out = new Set<number>(readSeen());
    for (const f of favorites) out.add(f.kinopoiskId);
    for (const w of watching) out.add(w.filmId);
    return out;
  };

  /** Takes random pages until the pool has a few films in it (at most three requests, each cached for a day). */
  const fill = async (): Promise<void> => {
    const c = criteria.current;
    if (!c) return;
    const skip = excluded();
    for (let tries = 0; tries < 3 && pool.current.length < 3 && pagesLeft.current.length > 0; tries++) {
      const page = pagesLeft.current.splice(randomBelow(pagesLeft.current.length), 1)[0];
      const r = await kpFilmsFilter({ kind: "FILM", genre: c.genre, ratingFrom: c.ratingFrom, yearFrom: c.yearFrom, order: "NUM_VOTE" }, page);
      // The list is shorter than the page asked for: only the pages that exist may be drawn from now on.
      if (r.totalPages > 0) pagesLeft.current = pagesLeft.current.filter((p) => p <= r.totalPages);
      for (const f of r.items ?? []) {
        if (f.posterUrlPreview && !skip.has(f.kinopoiskId) && !pool.current.some((p) => p.kinopoiskId === f.kinopoiskId)) pool.current.push(f);
      }
    }
  };

  /** Draws one film out of the pool (refilling it first if it ran dry) and shows it. */
  const draw = async () => {
    const mine = ++generation.current;
    setStep("loading");
    try {
      if (pool.current.length === 0) await fill();
      if (mine !== generation.current) return;
      if (pool.current.length === 0) {
        setStep("empty");
        return;
      }
      const [picked] = pool.current.splice(randomBelow(pool.current.length), 1);
      rememberSeen(picked.kinopoiskId);
      // The lists carry no description; the film's own record does (one cached request for the one shown).
      let full = picked;
      if (!picked.description) {
        full = await kpFilm(picked.kinopoiskId)
          .then((f) => ({ ...picked, ...f }) as KpCollectionItem)
          .catch(() => picked);
        if (mine !== generation.current) return;
      }
      setFilm(full);
      setStep("result");
    } catch {
      if (mine === generation.current) setStep("empty");
    }
  };

  const pickMood = (m: (typeof MOODS)[number]) => {
    setMood(m);
    setStep("risk");
  };

  const pickRisk = (risk: (typeof RISKS)[number]) => {
    let genre: number | undefined;
    if (mood && mood.genres.length > 0) {
      genre = mood.genres.map((n) => genreIds?.get(normalizeGenre(n))).find((id) => id != null);
      if (genre == null) {
        setStep("empty");
        return;
      }
    }
    // A coin toss on the era (any, or from 2000 on) keeps the "good" and "risky" picks from being the same classics.
    const yearFrom = risk.key !== "safe" && randomBelow(2) === 0 ? 2000 : undefined;
    criteria.current = { genre, ratingFrom: risk.ratingFrom, yearFrom };
    pagesLeft.current = shuffled(Array.from({ length: risk.pages }, (_, i) => i + 1));
    pool.current = [];
    void draw();
  };

  const restart = () => {
    generation.current++;
    setStep("mood");
    setFilm(null);
    setMood(null);
  };

  const meta = film
    ? [film.year, film.genres?.slice(0, 2).map((g) => g.genre).join(", ")].filter(Boolean).join(" · ")
    : "";

  return (
    <Modal
      focusKey="what-to-watch"
      preferredChildFocusKey="wtw:0"
      onClose={onClose}
      className={`wtw-tv ${step === "result" ? "wtw-tv--result" : ""}`}
    >
      <h3 className="wtw-tv__title">
        {step === "mood" && "Что посмотреть?"}
        {step === "risk" && "Насколько рискнём?"}
        {step === "loading" && "Подбираю…"}
        {step === "result" && "Попробуйте это"}
        {step === "empty" && "Ничего не нашлось"}
      </h3>
      {step === "mood" && <p className="wtw-tv__sub">Какое настроение?</p>}

      {step === "mood" && (
        <FocusGroup focusKey="wtw:moods" className="wtw-tv__list" preferredChildFocusKey="wtw:0">
          {MOODS.map((m, i) => (
            <Focusable key={m.key} as="button" className="wtw-tv__row" focusKey={`wtw:${i}`} autoFocus={i === 0} scroll={false} onPress={() => pickMood(m)}>
              <span className="wtw-tv__name">{m.label}</span>
              <NextIcon size={20} />
            </Focusable>
          ))}
        </FocusGroup>
      )}

      {step === "risk" && (
        <FocusGroup focusKey="wtw:risks" className="wtw-tv__list" preferredChildFocusKey="wtw:risk:0">
          {RISKS.map((r, i) => (
            <Focusable key={r.key} as="button" className="wtw-tv__row" focusKey={`wtw:risk:${i}`} autoFocus={i === 0} scroll={false} onPress={() => pickRisk(r)}>
              <span className="wtw-tv__name">{r.label}</span>
              <span className="wtw-tv__hint">{r.hint}</span>
              <NextIcon size={20} />
            </Focusable>
          ))}
          <Focusable as="button" back className="wtw-tv__row wtw-tv__row--quiet" focusKey="wtw:risk:back" scroll={false} onPress={restart}>
            <BackIcon size={20} />
            <span className="wtw-tv__name">Другое настроение</span>
          </Focusable>
        </FocusGroup>
      )}

      {step === "loading" && (
        <div className="wtw-tv__wait">
          <Spinner />
        </div>
      )}

      {step === "empty" && (
        <FocusGroup focusKey="wtw:empty" className="wtw-tv__list" preferredChildFocusKey="wtw:retry">
          <p className="wtw-tv__sub">Попробуйте другое настроение или смелее выберите рейтинг.</p>
          <Focusable as="button" className="wtw-tv__row" focusKey="wtw:retry" autoFocus scroll={false} onPress={restart}>
            <span className="wtw-tv__name">Начать заново</span>
            <NextIcon size={20} />
          </Focusable>
        </FocusGroup>
      )}

      {step === "result" && film && (
        <FocusGroup focusKey="wtw:result" className="wtw-tv__result" preferredChildFocusKey="wtw:open">
          <div className="wtw-tv__poster">
            <ProgressiveImg src={img(film.posterUrl)} placeholder={img(film.posterUrlPreview)} alt="" />
          </div>
          <div className="wtw-tv__info">
            <h4 className="wtw-tv__film">{film.nameRu || film.nameOriginal}</h4>
            <div className="wtw-tv__meta">
              {film.ratingKinopoisk != null && film.ratingKinopoisk > 0 && <span className="wtw-tv__rating">★ {film.ratingKinopoisk.toFixed(1)}</span>}
              {meta && <span>{meta}</span>}
            </div>
            <p className="wtw-tv__desc">{film.description || "Описание пока не добавлено."}</p>
            <div className="wtw-tv__actions">
              <Focusable as="button" className="wtw-tv__btn wtw-tv__btn--primary" focusKey="wtw:open" autoFocus scroll={false} onPress={() => onOpenFilm(film)}>
                <PlayIcon size={18} />
                Открыть
              </Focusable>
              <Focusable as="button" className="wtw-tv__btn" focusKey="wtw:another" scroll={false} onPress={() => void draw()}>
                Другой фильм
              </Focusable>
              <Focusable as="button" back className="wtw-tv__btn" focusKey="wtw:restart" scroll={false} onPress={restart}>
                Другое настроение
              </Focusable>
            </div>
          </div>
        </FocusGroup>
      )}
    </Modal>
  );
}
