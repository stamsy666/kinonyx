import { describe, expect, it } from "vitest";
import { btihOf, mergeReleases, normalizeJacred } from "./jacred";

const HASH = "0123456789abcdef0123456789abcdef01234567";
const magnet = `magnet:?xt=urn:btih:${HASH.toUpperCase()}&dn=x`;

describe("normalizeJacred", () => {
  it("reads the v1 list and skips items without a magnet", () => {
    const out = normalizeJacred([
      { tracker: "rutor", title: "Дюна 2021 BDRip 1080p", sizeName: "9.5 GB", sid: 40, pir: 3, magnet },
      { tracker: "kinozal", title: "No magnet here", sid: 1 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ provider: "JacRed · rutor", name: "Дюна 2021 BDRip 1080p", size: "9.5 GB", seeds: 40, peers: 3, hash: magnet });
  });
  it("reads a Jackett-style answer", () => {
    const out = normalizeJacred({ Results: [{ Tracker: "x", Title: "T", Size: 2 * 1024 ** 3, Seeders: 5, Peers: 1, MagnetUri: magnet }] });
    expect(out[0]).toMatchObject({ name: "T", size: "2.00 GB", seeds: 5 });
  });
  it("gives nothing for anything else", () => {
    expect(normalizeJacred("apikey")).toEqual([]);
  });
});

describe("mergeReleases", () => {
  it("keeps one copy of the same info-hash, the one with more seeders", () => {
    const a = [{ id: "1", provider: "RuTor", name: "A", hash: HASH, seeds: 3 }];
    const b = [{ id: "2", provider: "JacRed · rutor", name: "A", hash: magnet, seeds: 30 }];
    const out = mergeReleases(a, b);
    expect(out).toHaveLength(1);
    expect(out[0].seeds).toBe(30);
    expect(btihOf(out[0].hash)).toBe(HASH);
  });
  it("keeps releases that have no hash", () => {
    expect(mergeReleases([{ id: "1", provider: "X", name: "A" }], [{ id: "2", provider: "Y", name: "B" }])).toHaveLength(2);
  });
});
