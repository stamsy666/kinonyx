import type { CatchupInfo } from "./types";

export interface CatchupTarget {
  /** Start of the archived segment. */
  start: Date;
  durationSec: number;
}

function pad(n: number, len = 2) {
  return String(n).padStart(len, "0");
}

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\$\{(\w+)\}|\{(\w+)\}/g, (_, a: string | undefined, b: string | undefined) => vars[a ?? b ?? ""] ?? "");
}

function insertBeforeLastSegment(url: string, segment: string): string {
  const hashIdx = url.indexOf("#");
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : "";
  const qIdx = base.indexOf("?");
  const path = qIdx >= 0 ? base.slice(0, qIdx) : base;
  const query = qIdx >= 0 ? base.slice(qIdx) : "";
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash < 0) return `${segment}/${path}${query}${hash}`;
  return `${path.slice(0, lastSlash)}/${segment}${path.slice(lastSlash)}${query}${hash}`;
}

/** Xtream-Codes timeshift: .../live/<user>/<pass>/<id>.<ext> -> .../timeshift/<user>/<pass>/<durationMin>/<YYYY-MM-DD:HH-MM>/<id>.<ext> */
function buildXtreamTimeshiftUrl(url: string, target: CatchupTarget): string {
  const m = /^(https?:\/\/[^/]+)\/(?:live|movie|series)\/([^/]+)\/([^/]+)\/(\d+)\.(\w+)(\?.*)?$/i.exec(url);
  if (!m) return url;
  const [, host, user, pass, id, ext, query = ""] = m;
  const durationMin = Math.max(1, Math.ceil(target.durationSec / 60));
  const d = target.start;
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}:${pad(d.getHours())}-${pad(d.getMinutes())}`;
  return `${host}/timeshift/${user}/${pass}/${durationMin}/${stamp}/${id}.${ext}${query}`;
}

/**
 * Builds a catch-up (archive) stream URL for a channel, per its M3U `catchup`
 * attributes. Formats vary a lot between providers — this covers the
 * conventions seen across common playlists (Ministra/Stalker-style `shift`,
 * explicit `catchup-source` templates, Flussonic, Xtream-Codes). If a
 * provider uses something bespoke, `catchup.source` (a raw template string
 * with `{utc}`/`{start}`/`{end}`/`{lutc}`/`{duration}`/`{offset}`/`{Y}{m}{d}{H}{M}{S}`
 * placeholders) is the escape hatch — set it from the playlist and it wins
 * over the built-in per-type logic below.
 */
export function buildCatchupUrl(channelUrl: string, catchup: CatchupInfo | undefined, target: CatchupTarget): string {
  if (!catchup) return channelUrl;

  const startUnix = Math.floor(target.start.getTime() / 1000);
  const nowUnix = Math.floor(Date.now() / 1000);
  const vars: Record<string, string> = {
    utc: String(startUnix),
    start: String(startUnix),
    timestamp: String(startUnix),
    lutc: String(nowUnix),
    end: String(startUnix + target.durationSec),
    duration: String(target.durationSec),
    offset: String(Math.max(0, nowUnix - startUnix)),
    Y: String(target.start.getFullYear()),
    m: pad(target.start.getMonth() + 1),
    d: pad(target.start.getDate()),
    H: pad(target.start.getHours()),
    M: pad(target.start.getMinutes()),
    S: pad(target.start.getSeconds()),
  };

  switch (catchup.type) {
    case "flussonic":
      return insertBeforeLastSegment(channelUrl, `archive-${startUnix}-${target.durationSec}`);
    case "xc":
      return buildXtreamTimeshiftUrl(channelUrl, target);
    case "append": {
      const suffix = catchup.source ? fillTemplate(catchup.source, vars) : `?utc=${startUnix}&lutc=${nowUnix}`;
      return channelUrl + suffix;
    }
    case "default":
    case "shift":
    default: {
      if (catchup.source) return fillTemplate(catchup.source, vars);
      const sep = channelUrl.includes("?") ? "&" : "?";
      return `${channelUrl}${sep}utc=${startUnix}&lutc=${nowUnix}`;
    }
  }
}

/** Whether `programme` still falls inside the provider's advertised catch-up window. */
export function isWithinCatchupWindow(catchup: CatchupInfo | undefined, programmeStart: number, now = Date.now()): boolean {
  if (!catchup) return false;
  const days = catchup.days && catchup.days > 0 ? catchup.days : 3;
  return programmeStart >= now - days * 86_400_000 && programmeStart <= now;
}
