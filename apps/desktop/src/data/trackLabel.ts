interface TrackLike {
  title?: string;
  lang?: string;
}

/** One line per track — no second "ru"/"en" line. The language is only added (to the name) when
 *  two tracks would otherwise read the same ("Forced" in Russian and in English). */
export function trackLabel(t: TrackLike, all: TrackLike[], index: number): string {
  const name = t.title || t.lang || `Дорожка ${index + 1}`;
  const clash = t.title && t.lang && all.filter((o) => (o.title || o.lang) === t.title).length > 1;
  return clash ? `${name} · ${t.lang}` : name;
}
