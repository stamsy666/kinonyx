/** Series files carry the episode in their name in a handful of ways; one normalised key lets
 *  progress follow the episode across different releases/torrents of the same series. */
export function episodeKey(file: { path: string; name: string }): string {
  const name = file.name;
  const pad = (n: string) => n.padStart(2, "0");
  let m = name.match(/s(\d{1,2})\s*[ ._-]?\s*e(\d{1,3})/i) ?? file.path.match(/s(\d{1,2})\s*[ ._-]?\s*e(\d{1,3})/i);
  if (m) return `S${pad(m[1])}E${pad(m[2])}`;
  m = name.match(/(?:^|[^\d])(\d{1,2})x(\d{2,3})(?!\d)/i);
  if (m) return `S${pad(m[1])}E${pad(m[2])}`;
  m = name.match(/(?:серия|эпизод|эп|episode|ep)[ ._-]*(\d{1,3})/i) ?? name.match(/(\d{1,3})[ ._-]*(?:серия|эпизод)/i);
  const season = file.path.match(/(?:сезон|season)[ ._-]*(\d{1,2})/i) ?? file.path.match(/(?:^|[/\ ._-])s(\d{1,2})(?:[/\ ._-]|$)/i);
  if (m) return season ? `S${pad(season[1])}E${pad(m[1])}` : `E${pad(m[1])}`;
  m = name.match(/[[( _.-](\d{2,3})[\]) _.-]/);
  if (m) return season ? `S${pad(season[1])}E${pad(m[1])}` : `E${pad(m[1])}`;
  return name.toLowerCase();
}

/** "S01E03" → "1 сезон · 3 серия", "E07" → "7 серия"; anything else (a plain file name) as is. */
export function episodeLabel(key: string, fallback: string): string {
  const full = key.match(/^S(\d+)E(\d+)$/);
  if (full) return `${Number(full[1])} сезон · ${Number(full[2])} серия`;
  const only = key.match(/^E(\d+)$/);
  if (only) return `${Number(only[1])} серия`;
  return fallback;
}
