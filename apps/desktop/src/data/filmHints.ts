import type { KpFilm, KpStaffPerson } from "./api";

/**
 * What the local translator is told about a film besides its sound (`translator_film_start`):
 * the title and a line of synopsis (so a film isn't translated as "a live TV broadcast"), the
 * characters as Kinopoisk spells them in Russian (so «Walter» is «Уолтер» on every line, not
 * «Вальтер» on one and «Уолтер» on the next), and fixed renderings such as the original title.
 */
export interface FilmHints {
  title?: string;
  synopsis?: string;
  glossary: [string, string][];
  cast: string[];
}

const MAX_CAST = 12;
const CYRILLIC = /[а-яё]/i;

/** "Уолтер Уайт / Хайзенберг" → both names; "(в титрах не указан)" and voice-role notes dropped. */
function characterNames(description: string): string[] {
  return description
    .replace(/\([^)]*\)/g, " ")
    .split(/\s*[/,;]\s*/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 2 && s.length <= 40 && CYRILLIC.test(s) && !/^(камео|озвучка|голос)$/i.test(s));
}

/**
 * Characters, top-billed first, in Russian. Kinopoisk puts the character in the actor's `description`
 * («Уолтер Уайт»); TMDB has only English character names (`professionText`), which don't help here.
 */
export function castFromStaff(staff: KpStaffPerson[]): string[] {
  const out: string[] = [];
  for (const p of staff) {
    if (p.professionKey !== "ACTOR" || !p.description) continue;
    for (const name of characterNames(p.description)) {
      if (!out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
      if (out.length >= MAX_CAST) return out;
    }
  }
  return out;
}

export function glossaryFromFilm(film: Pick<KpFilm, "nameRu" | "nameOriginal"> | null | undefined): [string, string][] {
  const ru = film?.nameRu?.trim();
  const orig = film?.nameOriginal?.trim();
  if (!ru || !orig || ru.toLowerCase() === orig.toLowerCase() || CYRILLIC.test(orig)) return [];
  return [[orig, ru]];
}

/** Waits at most `ms` — the translator must not be held up by a slow metadata server. */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

export async function loadFilmHints(
  filmId: number | undefined,
  known: { nameRu?: string; nameOriginal?: string } | undefined,
  fallbackTitle: string,
): Promise<FilmHints> {
  // Loaded here, not at the top: api.ts needs a window, and the pure helpers above are tested without one.
  const { kpFilm, kpStaff } = await import("./api");
  const [film, staff] = filmId
    ? await Promise.all([within<KpFilm | null>(kpFilm(filmId), 2500, null), within<KpStaffPerson[]>(kpStaff(filmId), 2500, [])])
    : [null, [] as KpStaffPerson[]];
  const names = { nameRu: film?.nameRu ?? known?.nameRu, nameOriginal: film?.nameOriginal ?? known?.nameOriginal };
  return {
    title: names.nameRu || names.nameOriginal || fallbackTitle || undefined,
    synopsis: film?.description?.trim() || undefined,
    glossary: glossaryFromFilm(names),
    cast: castFromStaff(Array.isArray(staff) ? staff : []),
  };
}
