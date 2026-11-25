import { beforeEach, describe, expect, it, vi } from "vitest";

const mpv = vi.hoisted(() => ({
  init: vi.fn(async () => undefined),
  command: vi.fn(async (_command: string, _args?: unknown[]) => undefined),
  setProperty: vi.fn(async (_name: string, _value: unknown) => undefined),
  getProperty: vi.fn(async () => undefined),
  listenEvents: vi.fn(async () => () => undefined),
  observeProperties: vi.fn(async () => () => undefined),
}));
const invoke = vi.hoisted(() => vi.fn<(_command: string, _args: { multiplier: number }) => Promise<string>>());

vi.mock("../../../../packages/player-core/node_modules/tauri-plugin-libmpv-api/dist-js/index.js", () => mpv);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./io", () => ({ isTauri: false }));
vi.mock("../store/app", () => ({}));

describe("shared playback audio output", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("applies the same device on film and live TV and switches to Windows default without reloading", async () => {
    const { MpvAdapter, refreshMpvAudioDevice } = await import("@kinonyx/player-core");
    const device = "wasapi/{headphones}";
    let preferred = device;
    const resolve = async () => preferred;
    const film = new MpvAdapter(resolve);
    const tv = new MpvAdapter(resolve);

    await film.load({ url: "film.mkv" });
    await tv.load({ url: "channel.m3u8", live: true });
    expect(film.getState().error).toBeUndefined();

    expect(mpv.setProperty).toHaveBeenCalledWith("audio-device", device);
    expect(mpv.command.mock.calls.filter(([name]) => name === "loadfile")).toHaveLength(2);
    expect(mpv.setProperty.mock.invocationCallOrder[mpv.setProperty.mock.calls.findIndex(([name]) => name === "audio-device")])
      .toBeLessThan(mpv.command.mock.invocationCallOrder[0]);

    preferred = "auto";
    await refreshMpvAudioDevice(resolve);
    expect(mpv.setProperty).toHaveBeenLastCalledWith("audio-device", "auto");
    expect(mpv.command.mock.calls.filter(([name]) => name === "loadfile")).toHaveLength(2);
  });

  it("returns to Windows default when the stored endpoint is unavailable", async () => {
    const { resolveAudioDevice } = await import("./audioDevices");
    const devices = [{ name: "wasapi/{speakers}", description: "Speakers" }];
    expect(resolveAudioDevice("wasapi/{disconnected}", devices)).toBe("auto");
    expect(resolveAudioDevice("", devices)).toBe("auto");
    expect(resolveAudioDevice("wasapi/{speakers}", devices)).toBe("wasapi/{speakers}");
  });

  it("clears pause on a new file, keeps it on a same-file refresh, and seeks to credits without changing subtitles", async () => {
    const { MpvAdapter } = await import("@kinonyx/player-core");
    const player = new MpvAdapter();
    await player.load({ url: "episode-1.mkv" });
    await player.pause();
    await player.load({ url: "episode-1.mkv", mpvOptions: { "sub-scale": "1.2" } });
    expect(mpv.setProperty.mock.calls.filter(([name, value]) => name === "pause" && value === false)).toHaveLength(1);

    await player.load({ url: "episode-2.mkv" });
    expect(mpv.setProperty.mock.calls.filter(([name, value]) => name === "pause" && value === false)).toHaveLength(2);

    await player.selectTrack("subtitle", "2");
    mpv.setProperty.mockClear();
    mpv.command.mockClear();
    await player.seekBy(30, true);
    expect(mpv.command.mock.calls).toEqual([["seek", [30, "relative+exact"]]]);
    expect(mpv.setProperty).not.toHaveBeenCalled();
  });

  it("applies frame generation to film and live TV, then resets the shared player if the runtime is unavailable", async () => {
    const { MpvAdapter } = await import("@kinonyx/player-core");
    const film = new MpvAdapter();
    const tv = new MpvAdapter();
    invoke.mockResolvedValueOnce("@framegen2:test").mockResolvedValueOnce("@framegen3:test");

    await film.load({ url: "film.mkv", frameGeneration: 2 });
    expect(invoke).toHaveBeenNthCalledWith(1, "frame_generation_filter", { multiplier: 2 });
    expect(mpv.setProperty).toHaveBeenCalledWith("vf", "@framegen2:test");
    expect(mpv.setProperty).toHaveBeenCalledWith("hwdec", "auto-copy");

    await tv.load({ url: "channel.m3u8", live: true, frameGeneration: 3 });
    expect(invoke).toHaveBeenNthCalledWith(2, "frame_generation_filter", { multiplier: 3 });
    expect(mpv.setProperty).toHaveBeenCalledWith("vf", "@framegen3:test");

    mpv.setProperty.mockClear();
    invoke.mockRejectedValueOnce(new Error("Runtime unavailable"));
    await film.load({ url: "another-film.mkv", frameGeneration: 2 });
    expect(mpv.setProperty).toHaveBeenCalledWith("vf", "");
    expect(mpv.setProperty).toHaveBeenCalledWith("hwdec", "auto-safe");
    expect(film.getState().error).toBeUndefined();
  });

  it("changes DLSS while playing and restores existing video options without reopening or seeking", async () => {
    const { MpvAdapter } = await import("@kinonyx/player-core");
    const player = new MpvAdapter();
    await player.load({ url: "film.mkv", mpvOptions: { vf: "base", hwdec: "auto-safe" } });
    mpv.command.mockClear();
    mpv.setProperty.mockClear();
    invoke.mockResolvedValueOnce("@framegen2:test").mockResolvedValueOnce("@framegen3:test");

    await player.setFrameGeneration(2);
    await player.setFrameGeneration(3);
    await player.setFrameGeneration(0);

    expect(mpv.setProperty.mock.calls).toEqual([
      ["hwdec", "auto-copy"], ["vf", "base,@framegen2:test"],
      ["hwdec", "auto-copy"], ["vf", "base,@framegen3:test"],
      ["vf", "base"], ["hwdec", "auto-safe"],
    ]);
    expect(mpv.command).not.toHaveBeenCalled();
  });
});
