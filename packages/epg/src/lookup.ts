import type { Channel, EpgData, NowNext, Programme } from "./types";

/** Index of the programme airing at `time`, or -1. Programmes must be sorted by start. */
export function findProgrammeIndex(list: Programme[], time: number): number {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = list[mid];
    if (time < p.start) hi = mid - 1;
    else if (time >= p.stop) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export function nowNext(list: Programme[] | undefined, time = Date.now()): NowNext {
  if (!list || list.length === 0) return {};
  const i = findProgrammeIndex(list, time);
  if (i < 0) {
    // Nothing airing right now: report the first upcoming programme as "next".
    const upcoming = list.find((p) => p.start > time);
    return { next: upcoming };
  }
  const now = list[i];
  return {
    now,
    next: list[i + 1],
    progress: Math.min(1, Math.max(0, (time - now.start) / (now.stop - now.start))),
  };
}

export function programmesBetween(list: Programme[] | undefined, from: number, to: number): Programme[] {
  if (!list) return [];
  return list.filter((p) => p.stop > from && p.start < to);
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/(?<![\p{L}\p{N}])(hd|fhd|uhd|4k|sd|tv|тв|канал)(?![\p{L}\p{N}])/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/**
 * Resolves the XMLTV channel id for a playlist channel: tvg-id first,
 * then a normalized display-name match.
 */
export function buildEpgIndex(epg: EpgData): Map<string, string> {
  const byName = new Map<string, string>();
  for (const ch of epg.channels.values()) {
    for (const dn of ch.displayNames) {
      const key = normalizeName(dn);
      if (key && !byName.has(key)) byName.set(key, ch.id);
    }
  }
  return byName;
}

export function resolveEpgChannelId(
  channel: Pick<Channel, "tvgId" | "tvgName" | "name">,
  epg: EpgData,
  nameIndex: Map<string, string>,
): string | undefined {
  if (channel.tvgId && epg.programmes.has(channel.tvgId)) return channel.tvgId;
  for (const candidate of [channel.tvgName, channel.name]) {
    if (!candidate) continue;
    const id = nameIndex.get(normalizeName(candidate));
    if (id) return id;
  }
  return undefined;
}
