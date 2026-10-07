import { buildCatchupUrl, isWithinCatchupWindow } from "./catchup";

const target = { start: new Date(2026, 8, 21, 12, 30, 0), durationSec: 1800 };
const startUnix = Math.floor(target.start.getTime() / 1000);

describe("buildCatchupUrl", () => {
  it("returns the original url when there is no catchup info", () => {
    expect(buildCatchupUrl("http://x/a.m3u8", undefined, target)).toBe("http://x/a.m3u8");
  });

  it("shift/default without a template appends utc+lutc query params", () => {
    const url = buildCatchupUrl("http://x/a.m3u8", { type: "shift" }, target);
    expect(url).toBe(`http://x/a.m3u8?utc=${startUnix}&lutc=${url.match(/lutc=(\d+)/)![1]}`);
    expect(url.startsWith(`http://x/a.m3u8?utc=${startUnix}&lutc=`)).toBe(true);
  });

  it("appends to an url that already has a query string using &", () => {
    const url = buildCatchupUrl("http://x/a.m3u8?token=abc", { type: "default" }, target);
    expect(url.startsWith(`http://x/a.m3u8?token=abc&utc=${startUnix}&lutc=`)).toBe(true);
  });

  it("fills a custom catchup-source template with placeholders", () => {
    const url = buildCatchupUrl("http://x/live/1.m3u8", { type: "shift", source: "http://x/vod/${start}/${duration}.m3u8" }, target);
    expect(url).toBe(`http://x/vod/${startUnix}/1800.m3u8`);
  });

  it("supports single-brace placeholders too", () => {
    const url = buildCatchupUrl("http://x/1.m3u8", { type: "append", source: "?from={utc}&to={end}" }, target);
    expect(url).toBe(`http://x/1.m3u8?from=${startUnix}&to=${startUnix + 1800}`);
  });

  it("flussonic inserts an archive-<start>-<duration> path segment", () => {
    const url = buildCatchupUrl("http://x/channel1/index.m3u8", { type: "flussonic" }, target);
    expect(url).toBe(`http://x/channel1/archive-${startUnix}-1800/index.m3u8`);
  });

  it("xc rewrites a live URL into a timeshift URL", () => {
    const url = buildCatchupUrl("http://host:8080/live/user1/pass1/555.ts", { type: "xc" }, target);
    expect(url).toBe("http://host:8080/timeshift/user1/pass1/30/2026-09-21:12-30/555.ts");
  });

  it("xc falls back to the original url when it does not match the expected shape", () => {
    expect(buildCatchupUrl("http://x/weird.m3u8", { type: "xc" }, target)).toBe("http://x/weird.m3u8");
  });
});

describe("isWithinCatchupWindow", () => {
  const now = Date.now();

  it("is false without catchup info", () => {
    expect(isWithinCatchupWindow(undefined, now - 1000)).toBe(false);
  });

  it("is true within the default 3-day window", () => {
    expect(isWithinCatchupWindow({ type: "shift" }, now - 86_400_000)).toBe(true);
  });

  it("respects an explicit days window", () => {
    expect(isWithinCatchupWindow({ type: "shift", days: 1 }, now - 2 * 86_400_000)).toBe(false);
  });

  it("is false for programmes in the future", () => {
    expect(isWithinCatchupWindow({ type: "shift" }, now + 60_000)).toBe(false);
  });
});
