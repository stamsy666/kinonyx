import type { TorApiRelease } from "./api";

const YEAR = /(?:^|[^\d])((?:19|20)\d{2})(?!\d)/g;

/** Every 4-digit year (1900–2099) a release title mentions. Resolutions ("1080p", "2160p") can't
 *  match: they don't start with 19/20. */
export function yearsIn(name: string): number[] {
  return [...name.matchAll(YEAR)].map((m) => Number(m[1]));
}

/** Splits search results into those that fit the film's year and those that name a *different*
 *  year only (other films with the same title, remakes). A title that names no year at all is
 *  kept — trackers often omit it. Never hides everything: if nothing names the right year,
 *  the year says nothing useful and all results are kept. */
export function splitByYear(releases: TorApiRelease[], year: number | undefined): { relevant: TorApiRelease[]; hidden: TorApiRelease[] } {
  if (!year) return { relevant: releases, hidden: [] };
  const fits = (r: TorApiRelease) => {
    const ys = yearsIn(r.name);
    return ys.length === 0 || ys.includes(year);
  };
  const relevant = releases.filter(fits);
  const anyExact = releases.some((r) => yearsIn(r.name).includes(year));
  if (!anyExact || relevant.length === 0) return { relevant: releases, hidden: [] };
  return { relevant, hidden: releases.filter((r) => !fits(r)) };
}
