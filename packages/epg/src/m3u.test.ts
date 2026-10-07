import { parseM3U } from "./m3u";

const SAMPLE = `#EXTM3U url-tvg="http://example.com/epg.xml.gz,http://example.com/epg2.xml"
#EXTINF:-1 tvg-id="first.ru" tvg-name="Первый" tvg-logo="http://logo/1.png" group-title="Эфирные, Федеральные" catchup="shift" catchup-days="7",Первый канал HD
#EXTVLCOPT:http-user-agent=PortoTV/1.0
http://stream/first.m3u8
#EXTGRP:Спорт
#EXTINF:-1,Матч ТВ
http://stream/match.ts

#EXTINF:-1 tvg-id="" group-title="Спорт",Матч Премьер
http://stream/match-premier.ts
`;

describe("parseM3U", () => {
  const pl = parseM3U(SAMPLE);

  it("reads header EPG urls", () => {
    expect(pl.epgUrls).toEqual(["http://example.com/epg.xml.gz", "http://example.com/epg2.xml"]);
  });

  it("parses attributes, keeping commas inside quoted values", () => {
    const ch = pl.channels[0];
    expect(ch.name).toBe("Первый канал HD");
    expect(ch.tvgId).toBe("first.ru");
    expect(ch.group).toBe("Эфирные, Федеральные");
    expect(ch.logo).toBe("http://logo/1.png");
    expect(ch.url).toBe("http://stream/first.m3u8");
    expect(ch.catchup).toEqual({ type: "shift", source: undefined, days: 7 });
    expect(ch.attrs["vlcopt:http-user-agent"]).toBe("PortoTV/1.0");
  });

  it("applies #EXTGRP when group-title is missing", () => {
    expect(pl.channels[1].name).toBe("Матч ТВ");
    expect(pl.channels[1].group).toBe("Спорт");
    expect(pl.channels[1].tvgId).toBeUndefined();
  });

  it("collects unique groups in order of appearance", () => {
    expect(pl.groups).toEqual(["Эфирные, Федеральные", "Спорт"]);
  });

  it("produces stable ids", () => {
    const again = parseM3U(SAMPLE);
    expect(again.channels.map((c) => c.id)).toEqual(pl.channels.map((c) => c.id));
    expect(new Set(pl.channels.map((c) => c.id)).size).toBe(3);
  });

  it("keeps ids stable when the provider re-signs links (token query, rotating host)", () => {
    const a = parseM3U(`#EXTM3U\n#EXTINF:0 tvg-id="ch3917", MTV 90s HD\nhttps://11.hls.gd/ch3917/mono.m3u8?token=aaa\n#EXTINF:0, No Id\nhttp://x/b.m3u8?t=1\n`);
    const b = parseM3U(`#EXTM3U\n#EXTINF:0 tvg-id="ch3917", MTV 90s HD\nhttps://12.hls.gd/ch3917/mono.m3u8?token=bbb\n#EXTINF:0, No Id\nhttp://y/b.m3u8?t=2\n`);
    expect(b.channels.map((c) => c.id)).toEqual(a.channels.map((c) => c.id));
  });

  it("keeps ids unique when a channel is repeated", () => {
    const dup = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-id="a",A\nhttp://x/a\n#EXTINF:-1 tvg-id="a",A\nhttp://x/a\n#EXTINF:-1 tvg-id="a",A\nhttp://x/a\n`);
    const ids = dup.channels.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[1]).toBe(`${ids[0]}#2`);
    expect(ids[2]).toBe(`${ids[0]}#3`);
  });

  it("treats tvg-rec as a legacy alias for catchup-days (no catchup/catchup-days present)", () => {
    const pl2 = parseM3U(`#EXTM3U\n#EXTINF:0 tvg-id="ch001" tvg-rec="7", Первый HD\nhttp://x/ch001.m3u8\n`);
    expect(pl2.channels[0].catchup).toEqual({ type: "default", source: undefined, days: 7 });
  });

  it("prefers explicit catchup-days over tvg-rec when both are present", () => {
    const pl2 = parseM3U(`#EXTM3U\n#EXTINF:0 catchup="shift" catchup-days="3" tvg-rec="7",X\nhttp://x/a\n`);
    expect(pl2.channels[0].catchup?.days).toBe(3);
  });
});
