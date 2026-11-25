import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openReleaseTorrent, openTorrent } from "./api";

vi.mock("./io", () => ({ isTauri: true }));
vi.mock("./log", () => ({ logEvent: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const hash = "0123456789abcdef0123456789abcdef01234567";
const magnet = `magnet:?xt=urn:btih:${hash}&tr=https%3A%2F%2Ftracker.example%2FCaseSensitive`;
const torrent = "https://releases.example/test.torrent";
const release = { id: "1", provider: "rutor", name: "Fixture", hash, torrent };
const files = [{ id: 1, path: "Season/Fixture.mkv", length: 12345 }];

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("opening torrent releases", () => {
  it("asks the tracker for its magnet even if the search response contained a bare hash", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([{ Magnet: magnet }]).mockResolvedValueOnce({ hash, file_stats: files });
    const result = await openReleaseTorrent(release);
    expect(result).toMatchObject({ hash, link: magnet, files: [{ id: 1, name: "Fixture.mkv" }] });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(1, "torapi_search_id", { provider: "rutor", id: "1" });
    expect(invoke).toHaveBeenNthCalledWith(2, "ts_add_magnet", { magnet: expect.stringContaining(magnet) });
  });

  it("tries the .torrent URL when a magnet still has no metadata", async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === "torapi_search_id") return [{ Magnet: magnet }];
      if (cmd === "ts_add_magnet" && args && "magnet" in args && args.magnet === torrent) {
        return { hash, file_stats: files };
      }
      return cmd === "ts_add_magnet" ? { hash } : {};
    });
    const opening = openReleaseTorrent(release);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await opening).toMatchObject({ link: torrent, files: [{ id: 1 }] });
  });

  it("stops at the metadata deadline without inferring seeder availability", async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockResolvedValue({ hash, total_peers: 40 });
    const failure = expect(openTorrent(magnet, undefined, 2_000)).rejects.toThrow("TorrServer не получил список файлов");
    await vi.advanceTimersByTimeAsync(2_000);
    await failure;
  });
});
