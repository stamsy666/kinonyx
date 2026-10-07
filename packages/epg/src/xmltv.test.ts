import { parseXMLTV, parseXmltvDate, decodeEntities } from "./xmltv";
import { nowNext, buildEpgIndex, resolveEpgChannelId, normalizeName } from "./lookup";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="test">
  <channel id="first.ru">
    <display-name lang="ru">Первый канал</display-name>
    <display-name>Channel One</display-name>
    <icon src="http://logo/1.png"/>
  </channel>
  <channel id="match.ru"><display-name>Матч ТВ</display-name></channel>
  <programme start="20260921120000 +0300" stop="20260921130000 +0300" channel="first.ru">
    <title lang="ru">Новости &amp; погода</title>
    <desc><![CDATA[Выпуск <новостей>]]></desc>
    <category>Инфо</category>
  </programme>
  <programme start="20260921100000 +0300" stop="20260921120000 +0300" channel="first.ru">
    <title>Утро</title>
  </programme>
  <programme start="20260921110000 +0300" stop="20260921140000 +0300" channel="match.ru">
    <title>Футбол</title>
  </programme>
</tv>`;

describe("parseXmltvDate", () => {
  it("handles explicit offsets", () => {
    expect(parseXmltvDate("20260921120000 +0300")).toBe(Date.UTC(2026, 8, 21, 9, 0, 0));
    expect(parseXmltvDate("20260921120000 -0130")).toBe(Date.UTC(2026, 8, 21, 13, 30, 0));
  });
  it("rejects garbage", () => {
    expect(parseXmltvDate("yesterday")).toBeNaN();
  });
});

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#1055;&#x43e;")).toBe("a & b <c> По");
  });
});

describe("parseXMLTV", () => {
  const epg = parseXMLTV(SAMPLE);

  it("parses channels with all display names and icon", () => {
    const ch = epg.channels.get("first.ru")!;
    expect(ch.displayNames).toEqual(["Первый канал", "Channel One"]);
    expect(ch.icon).toBe("http://logo/1.png");
  });

  it("parses programmes, decodes entities and CDATA, sorts by start", () => {
    const list = epg.programmes.get("first.ru")!;
    expect(list.map((p) => p.title)).toEqual(["Утро", "Новости & погода"]);
    expect(list[1].desc).toBe("Выпуск <новостей>");
    expect(list[1].category).toBe("Инфо");
  });

  it("finds now/next with progress", () => {
    const at = Date.UTC(2026, 8, 21, 9, 30, 0); // 12:30 +0300
    const nn = nowNext(epg.programmes.get("first.ru"), at);
    expect(nn.now?.title).toBe("Новости & погода");
    expect(nn.next).toBeUndefined();
    expect(nn.progress).toBeCloseTo(0.5);

    const before = nowNext(epg.programmes.get("first.ru"), Date.UTC(2026, 8, 21, 5, 0, 0));
    expect(before.now).toBeUndefined();
    expect(before.next?.title).toBe("Утро");
  });

  it("resolves playlist channels to EPG ids by tvg-id or name", () => {
    const index = buildEpgIndex(epg);
    expect(resolveEpgChannelId({ tvgId: "first.ru", name: "whatever" }, epg, index)).toBe("first.ru");
    expect(resolveEpgChannelId({ name: "Матч ТВ HD" }, epg, index)).toBe("match.ru");
    expect(resolveEpgChannelId({ tvgName: "Channel One", name: "x" }, epg, index)).toBe("first.ru");
    expect(resolveEpgChannelId({ name: "Unknown" }, epg, index)).toBeUndefined();
  });
});

describe("normalizeName", () => {
  it("strips quality tags, brackets and punctuation", () => {
    expect(normalizeName("Матч ТВ HD (orig)")).toBe("матч");
    expect(normalizeName("Discovery Channel [4K]")).toBe("discoverychannel");
  });
});
