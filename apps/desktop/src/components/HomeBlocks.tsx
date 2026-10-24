import { useEffect, useState } from "react";
import { Focusable } from "@kinonyx/ui";
import { kpImages, type KpCollectionItem } from "../data/api";
import { img, stillLarge } from "../data/images";

const metaOf = (film: KpCollectionItem) => ["Фильм", ...(film.genres?.map((g) => g.genre).slice(0, 2) ?? [])].join(" · ");

/** The first sentence of the description: one line under the title, not a paragraph. */
const taglineOf = (film: KpCollectionItem) => {
  const d = film.description?.trim();
  if (!d) return "";
  const m = d.match(/^.+?[.!?…](\s|$)/);
  return (m ? m[0] : d).trim();
};

/**
 * A big card of the home page (the Apple TV store's "featured" row): the film's art filling a tall
 * card, its title, a line about it and its first sentence over the bottom.
 */
export function FeatureCard({
  film,
  focusKey,
  autoFocus,
  onPress,
}: {
  film: KpCollectionItem;
  focusKey: string;
  autoFocus?: boolean;
  onPress: () => void;
}) {
  const title = film.nameRu || film.nameOriginal || "Без названия";
  const [broken, setBroken] = useState(false);
  const art = img(film.posterUrl || film.posterUrlPreview);
  return (
    <Focusable focusKey={focusKey} className="feature-card" autoFocus={autoFocus} scrollBlock="center" onPress={onPress}>
      {art && !broken && <img src={art} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />}
      <div className="feature-card__shade" />
      <div className="feature-card__text">
        <b>{title}</b>
        <span className="feature-card__meta">
          {metaOf(film)}
          {film.ratingKinopoisk ? <i>★ {film.ratingKinopoisk.toFixed(1)}</i> : null}
        </span>
        {taglineOf(film) && <span className="feature-card__line">{taglineOf(film)}</span>}
      </div>
    </Focusable>
  );
}

/**
 * The wide banner that opens a collection (the store's "From the Shadows"): a frame from its first
 * film across the row, the collection's name and a line about it. Enter goes to the collection's
 * first film in the row below.
 */
export function CollectionBanner({
  film,
  title,
  text,
  focusKey,
  onPress,
}: {
  film: KpCollectionItem;
  title: string;
  text?: string;
  focusKey: string;
  onPress: () => void;
}) {
  // A frame of the film reads as a scene; the poster is only the fallback (one cached request).
  const [still, setStill] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    kpImages(film.kinopoiskId, "STILL", 1)
      .then((r) => {
        const url = r.items?.[0]?.imageUrl;
        if (!cancelled && url) setStill(img(stillLarge(url)) ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [film.kinopoiskId]);
  const art = still ?? img(film.posterUrl || film.posterUrlPreview);
  return (
    <Focusable focusKey={focusKey} className="home-banner" scrollBlock="center" onPress={onPress}>
      {art && <img src={art} alt="" decoding="async" />}
      <div className="home-banner__shade" />
      <div className="home-banner__text">
        <b>{title}</b>
        {text && <span>{text}</span>}
      </div>
    </Focusable>
  );
}
