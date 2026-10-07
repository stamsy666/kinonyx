import type { EpgChannel, EpgData, Programme } from "./types";
import { parseAttributes } from "./m3u";

const ENTITY_RE = /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g;

export function decodeEntities(s: string): string {
  if (s.indexOf("&") < 0) return s;
  return s.replace(ENTITY_RE, (_, e: string) => {
    switch (e) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
    }
    const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _;
  });
}

function textOf(block: string, tag: string): string | undefined {
  const open = block.indexOf(`<${tag}`);
  if (open < 0) return undefined;
  const gt = block.indexOf(">", open);
  if (gt < 0 || block[gt - 1] === "/") return undefined;
  const close = block.indexOf(`</${tag}>`, gt);
  if (close < 0) return undefined;
  let inner = block.slice(gt + 1, close).trim();
  if (inner.startsWith("<![CDATA[") && inner.endsWith("]]>")) inner = inner.slice(9, -3);
  return decodeEntities(inner);
}

function allTextOf(block: string, tag: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const open = block.indexOf(`<${tag}`, from);
    if (open < 0) break;
    const gt = block.indexOf(">", open);
    if (gt < 0) break;
    const close = block.indexOf(`</${tag}>`, gt);
    if (close < 0) break;
    out.push(decodeEntities(block.slice(gt + 1, close).trim()));
    from = close + tag.length + 3;
  }
  return out;
}

const XMLTV_DATE_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?\s*(?:([+-])(\d{2})(\d{2}))?$/;

/** Parses XMLTV timestamps (YYYYMMDDhhmmss ±HHMM). Missing offset means local time, per the XMLTV DTD. */
export function parseXmltvDate(s: string): number {
  const m = XMLTV_DATE_RE.exec(s.trim());
  if (!m) return Number.NaN;
  const [, y, mo, d, h = "0", mi = "0", sec = "0", sign, oh, om] = m;
  if (sign) {
    const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
    const offsetMin = (+oh * 60 + +om) * (sign === "-" ? -1 : 1);
    return utc - offsetMin * 60_000;
  }
  return new Date(+y, +mo - 1, +d, +h, +mi, +sec).getTime();
}

export function parseXMLTV(xml: string): EpgData {
  const channels = new Map<string, EpgChannel>();
  const programmes = new Map<string, Programme[]>();

  let pos = 0;
  for (;;) {
    const open = xml.indexOf("<channel ", pos);
    if (open < 0) break;
    const close = xml.indexOf("</channel>", open);
    if (close < 0) break;
    const tagEnd = xml.indexOf(">", open);
    const { attrs } = parseAttributes(xml.slice(open, tagEnd));
    const inner = xml.slice(tagEnd + 1, close);
    const id = attrs["id"];
    if (id) {
      const iconTag = /<icon\s[^>]*src="([^"]*)"/.exec(inner);
      channels.set(id, {
        id,
        displayNames: allTextOf(inner, "display-name"),
        icon: iconTag ? decodeEntities(iconTag[1]) : undefined,
      });
    }
    pos = close + 10;
  }

  pos = 0;
  for (;;) {
    const open = xml.indexOf("<programme ", pos);
    if (open < 0) break;
    const close = xml.indexOf("</programme>", open);
    if (close < 0) break;
    const tagEnd = xml.indexOf(">", open);
    const { attrs } = parseAttributes(xml.slice(open, tagEnd));
    const inner = xml.slice(tagEnd + 1, close);
    pos = close + 12;

    const channelId = attrs["channel"];
    const start = parseXmltvDate(attrs["start"] ?? "");
    const stop = parseXmltvDate(attrs["stop"] ?? "");
    if (!channelId || Number.isNaN(start) || Number.isNaN(stop)) continue;

    const p: Programme = {
      channelId,
      start,
      stop,
      title: textOf(inner, "title") ?? "",
      desc: textOf(inner, "desc"),
      category: textOf(inner, "category"),
    };
    let list = programmes.get(channelId);
    if (!list) programmes.set(channelId, (list = []));
    list.push(p);
  }

  for (const list of programmes.values()) list.sort((a, b) => a.start - b.start);
  return { channels, programmes };
}
