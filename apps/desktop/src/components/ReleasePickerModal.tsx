import { useEffect, useRef, useState } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { AboutIcon, Focusable, NextIcon, Spinner, onBack } from "@kinonyx/ui";
import {
  openTorrent,
  parseSize,
  playableFiles,
  streamUrlFor,
  torApiSearchId,
  torApiSearchTitle,
  torrserveHealth,
  probeTracks,
  type ProbeTrack,
  type TorApiRelease,
  type TorrentFile,
} from "../data/api";
import { useLastRelease, type LastRelease } from "../store/lastRelease";
import { episodeKey, episodeLabel } from "../data/episodes";
import { useEpisodeProgress } from "../store/episodeProgress";
import { splitByYear } from "../data/releaseFilter";
import { jacredSearch, mergeReleases } from "../data/jacred";
import { lastSpeed, sustainable } from "../data/speedtest";
import { parseTags, tagLabels, type ReleaseTags } from "../data/releaseTags";
import { pickByQuality, qualityLabel, type QualityKey } from "../data/quality";
import { Modal } from "./Modal";

interface Props {
  filmId: number;
  title: string;
  year?: number;
  /** Film length — lets each release show the download speed it needs to play smoothly. */
  durationMin?: number;
  /** A previously-picked release for this film — if set, skips straight to reconnecting
   *  to it instead of a fresh title search, falling back to the normal search on failure. */
  remembered?: LastRelease;
  /** Quick pick: once the search is done, start the best release of this resolution at once
   *  instead of showing the list (the list is the fallback when none matches). */
  quality?: QualityKey;
  /** Download mode: picking a release (and an episode) hands the file to `onDownload` instead of starting playback. */
  download?: boolean;
  onDownload?: (pick: { link: string; hash: string; name: string; file: TorrentFile; multi: boolean }) => void;
  onClose: () => void;
  onReady: (source: {
    title: string;
    url: string;
    hash: string;
    /** Set when this release is a season pack (more than one playable file) — the rest
     *  of the files, so the player can offer "next episode" without reopening this modal. */
    episodes?: { hash: string; files: TorrentFile[]; index: number };
  }) => void;
}

type Stage = "searching" | "list" | "connecting" | "files" | "error" | "inspect";

// Filters and sorting of the list of releases (they are chips above it).
const MIN_SEEDS = [0, 3, 10, 30];
const VOICES: (ReleaseTags["voice"] | "any")[] = ["any", "Дубляж", "Многоголосая", "Оригинал"];
type Sort = "seeds" | "size" | "quality";
const SORTS: Sort[] = ["seeds", "size", "quality"];
const SORT_LABEL: Record<Sort, string> = { seeds: "по сидам", size: "по размеру", quality: "по качеству" };
const QUALITY_RANK: Record<string, number> = { "4K": 4, "1080p": 3, "720p": 2, SD: 1 };

// Below this many seeders a release rarely sustains even 1080p.
const FEW_SEEDS = 5;

/** Average bitrate = size ÷ runtime. Hidden when implausible (> 150 Mbit/s): that's a
 *  multi-film pack or a whole season, not one film. */
function neededMbit(size: string | undefined, durationMin: number | undefined): number | undefined {
  const bytes = parseSize(size);
  if (!bytes || !durationMin) return undefined;
  const mbit = (bytes * 8) / (durationMin * 60) / 1e6;
  return mbit > 0.3 && mbit <= 150 ? mbit : undefined;
}

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

export function ReleasePickerModal({ filmId, title, year, durationMin, remembered, quality, download, onDownload, onClose, onReady }: Props) {
  // A remembered release skips the search entirely and tries to reconnect straight away —
  // only a search-stage mount (nothing remembered, or the reconnect below failed) runs the
  // title search effect.
  const [stage, setStage] = useState<Stage>(remembered ? "connecting" : "searching");
  const [resuming, setResuming] = useState(!!remembered);
  const [releases, setReleases] = useState<TorApiRelease[]>([]);
  // Releases that name only another year (other films with the same title) — hidden unless asked for.
  const [hidden, setHidden] = useState<TorApiRelease[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [files, setFiles] = useState<{ hash: string; name: string; link: string; choices: TorrentFile[] } | null>(null);
  const [error, setError] = useState<string>("");
  // The quick pick found nothing of the asked resolution — the list is shown with a note.
  const [qualityMissed, setQualityMissed] = useState(false);
  // "What is inside": the release looked into, and what was found (or why not).
  const [inspecting, setInspecting] = useState<TorApiRelease | null>(null);
  const [probe, setProbe] = useState<{ tracks: ProbeTrack[]; duration: number; file: string } | null>(null);
  const [probeError, setProbeError] = useState("");
  const [minSeeds, setMinSeeds] = useState(0);
  const [voice, setVoice] = useState<ReleaseTags["voice"] | "any">("any");
  const [sort, setSort] = useState<Sort>("seeds");
  // For a series: only the releases that hold this season (0 = any).
  const [season, setSeason] = useState(0);
  // A filter changes the list under the viewer's thumb: the first row must not grab the focus from the chip (it is `autoFocus`
  // only for the first showing), and the chip is given the focus again once the list has been redrawn.
  const [filtersUsed, setFiltersUsed] = useState(false);
  const chipPressed = (key: string) => {
    setFiltersUsed(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setFocus(key)));
  };
  const cancel = useRef({ cancelled: false });

  // Fresh token per mount: StrictMode's dev-only unmount/remount would otherwise leave the
  // (ref-persisted) token cancelled forever, silently aborting every connect attempt.
  useEffect(() => {
    const token = { cancelled: false };
    cancel.current = token;
    return () => {
      token.cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      onBack(() => {
        // Back from the episode list returns to the releases, not all the way out.
        if (stage === "files" || stage === "inspect" || (stage === "error" && releases.length)) {
          setStage("list");
          return true;
        }
        onClose();
        return true;
      }),
    [onClose, stage, releases.length],
  );

  const fail = (e: unknown) => {
    if (cancel.current.cancelled) return;
    setError(e instanceof Error ? e.message : String(e));
    setStage("error");
  };

  async function play(link: string, hash: string, name: string, file: TorrentFile, episodeChoices: TorrentFile[]) {
    if (download) {
      onDownload?.({ link, hash, name, file, multi: episodeChoices.length > 1 });
      return;
    }
    const url = await streamUrlFor(hash, file);
    if (cancel.current.cancelled) return;
    const episodes =
      episodeChoices.length > 1 ? { hash, files: episodeChoices, index: episodeChoices.findIndex((f) => f.id === file.id) } : undefined;
    useLastRelease.getState().set(filmId, { link, fileId: file.id, filePath: file.path, releaseTitle: name });
    onReady({ title: name, url, hash, episodes });
  }

  // Tries the previously-picked release again — same TorrServer add + file lookup as a
  // fresh pick, just skipping the title search and the list of releases entirely. Falls
  // back to a normal search (below) if the link's gone stale (dead magnet, file renamed).
  useEffect(() => {
    if (!remembered) return;
    let cancelled = false;
    (async () => {
      try {
        if (!(await torrserveHealth())) {
          throw new Error("TorrServer не запущен — он стартует вместе с приложением, проверьте binaries/ (см. CLAUDE.md)");
        }
        const torrent = await openTorrent(remembered.link, cancel.current);
        if (cancelled || cancel.current.cancelled) return;
        const remembered_ = torrent.files.find((f) => f.id === remembered.fileId) ?? torrent.files.find((f) => f.path === remembered.filePath);
        const { choices } = playableFiles(torrent.files);
        // A series pack: not the file picked last time but the right one NOW — the episode
        // left half-watched, else the one after the last watched.
        const file = (choices.length > 1 ? useEpisodeProgress.getState().smartPick(filmId, choices) : undefined) ?? remembered_;
        if (!file) throw new Error("Файл не найден в раздаче");
        await play(remembered.link, torrent.hash, remembered.releaseTitle, file, choices);
      } catch {
        if (cancelled) return;
        // Dead link (no seeds left, file renamed) — don't keep retrying it on every
        // future "Смотреть" press for this film.
        useLastRelease.getState().clear(filmId);
        setResuming(false);
        setStage("searching");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (stage !== "searching") return;
    let cancelled = false;
    // "Title year" first — the year in the query cuts out other films with the same name; if
    // the trackers' own search doesn't cope with it (nothing found), the plain title.
    (async () => {
      // The second source (a JacRed server from Settings, if there is one) is asked at the same time; its failure is not the search's.
      const jac = jacredSearch(title).catch(() => []);
      let first: TorApiRelease[] = [];
      let failure: unknown;
      try {
        if (year) first = await torApiSearchTitle(`${title} ${year}`, year).catch(() => []);
        if (!first.length) first = await torApiSearchTitle(title, year);
      } catch (e) {
        failure = e;
      }
      // A server that does not answer must not keep the list waiting: what it has not given in a few seconds is left out.
      const second = await Promise.race([jac, new Promise<TorApiRelease[]>((done) => window.setTimeout(() => done([]), 5000))]);
      if (!first.length && !second.length && failure) throw failure;
      return mergeReleases(first, second);
    })()
      .then((all) => {
        if (cancelled) return;
        all.sort((a, b) => (b.seeds ?? 0) - (a.seeds ?? 0));
        const { relevant: list, hidden: other } = splitByYear(all, year);
        setHidden(other);
        setReleases(list);
        const best = quality ? pickByQuality(list, quality) : undefined;
        if (best) {
          void pick(best);
          return;
        }
        if (quality && list.length) setQualityMissed(true);
        setStage(list.length ? "list" : "error");
        if (!list.length) setError("Раздачи не найдены");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStage("error");
      });
    return () => {
      cancelled = true;
    };
  }, [stage, title, year]);

  /** The link TorrServer can add a release by (a magnet, a hash or a .torrent address) and its name. */
  async function resolveLink(release: TorApiRelease): Promise<{ link: string; name: string }> {
    let link = release.hash;
    let name = release.name;
    let lookupError: unknown;
    if (!link) {
      try {
        const detail = await torApiSearchId(release.provider, release.id);
        link = detail.magnet || detail.hash || detail.torrent;
        name = detail.name || name;
      } catch (e) {
        lookupError = e;
      }
    }
    // TorrServer can also add straight from the tracker's .torrent URL.
    link ||= release.torrent;
    if (!link) {
      throw new Error(
        lookupError instanceof Error
          ? `Не удалось получить ссылку на раздачу: ${lookupError.message}`
          : "Трекер не отдал ни magnet, ни .torrent для этой раздачи — выберите другую",
      );
    }
    return { link, name };
  }

  // "What is inside": connects to the release, opens its biggest file (the first episode of a pack) and reads its tracks.
  async function inspect(release: TorApiRelease) {
    setInspecting(release);
    setProbe(null);
    setProbeError("");
    setStage("inspect");
    try {
      if (!(await torrserveHealth())) throw new Error("TorrServer не запущен");
      const { link } = await resolveLink(release);
      const torrent = await openTorrent(link, cancel.current);
      if (cancel.current.cancelled) return;
      const { auto, choices } = playableFiles(torrent.files);
      const file = auto ?? choices[0];
      if (!file) throw new Error("В раздаче нет видеофайла");
      const url = await streamUrlFor(torrent.hash, file);
      const result = await probeTracks(url);
      if (cancel.current.cancelled) return;
      setProbe({ tracks: result.tracks, duration: result.duration, file: file.name });
    } catch (e) {
      if (cancel.current.cancelled) return;
      setProbeError(e instanceof Error ? e.message : String(e));
    }
  }

  async function pick(release: TorApiRelease) {
    setStage("connecting");
    try {
      if (!(await torrserveHealth())) {
        throw new Error("TorrServer не запущен — он стартует вместе с приложением, проверьте binaries/ (см. CLAUDE.md)");
      }
      const { link, name } = await resolveLink(release);
      const torrent = await openTorrent(link, cancel.current);
      if (cancel.current.cancelled) return;
      const { auto, choices } = playableFiles(torrent.files);
      if (auto) {
        await play(link, torrent.hash, name, auto, []);
      } else if (choices.length > 1 && useEpisodeProgress.getState().smartPick(filmId, choices) && quality) {
        // Quick pick of a series already started: no episode list, straight to the right one.
        await play(link, torrent.hash, name, useEpisodeProgress.getState().smartPick(filmId, choices)!, choices);
      } else {
        setFiles({ hash: torrent.hash, name, link, choices });
        setStage("files");
      }
    } catch (e) {
      fail(e);
    }
  }

  // The episode to highlight in the list: the one in progress, else the one after the last watched.
  const smartFile = stage === "files" && files ? useEpisodeProgress.getState().smartPick(filmId, files.choices) : undefined;

  const heading = stage === "inspect" ? "Что внутри раздачи" : download ? (stage === "files" ? "Какую серию скачать" : "Что скачать") : stage === "files" ? "Выбор серии" : "Выбор раздачи";

  const shownAll = showHidden ? [...releases, ...hidden] : releases;
  // The suggestion: the best-seeded release in good quality, with enough seeders to play smoothly.
  const speed = lastSpeed();
  // With a measured speed the suggestion is also one the connection carries (a film's average bitrate within what it can hold).
  const fits = (r: TorApiRelease) => {
    const need = neededMbit(r.size, durationMin);
    return !speed || !need || need <= sustainable(speed.mbit);
  };
  const bestId = [...releases]
    .filter((r) => ["4K", "1080p"].includes(parseTags(r.name).quality ?? "") && (r.seeds ?? 0) >= 10 && fits(r))
    .sort((a, b) => (b.seeds ?? 0) - (a.seeds ?? 0))[0]?.id;
  // The seasons the releases speak of: the season chip is only there for a series (two seasons or more are named).
  const seasonOptions = [...new Set(shownAll.flatMap((r) => parseTags(r.name).seasons ?? []))].sort((a, b) => a - b);
  const visible = shownAll
    .filter((r) => (r.seeds ?? 0) >= minSeeds && (voice === "any" || parseTags(r.name).voice === voice) && (season === 0 || (parseTags(r.name).seasons ?? []).includes(season)))
    .sort((a, b) => {
      if (sort === "size") return (parseSize(b.size) ?? 0) - (parseSize(a.size) ?? 0);
      if (sort === "quality") return (QUALITY_RANK[parseTags(b.name).quality ?? ""] ?? 0) - (QUALITY_RANK[parseTags(a.name).quality ?? ""] ?? 0) || (b.seeds ?? 0) - (a.seeds ?? 0);
      return (b.seeds ?? 0) - (a.seeds ?? 0);
    });

  return (
    <Modal focusKey="release-picker" preferredChildFocusKey="release:0" className="links-tv rel-tv" onClose={onClose}>
      <h3 className="links-tv__title">{heading}</h3>
      {stage === "list" && (
        <div className="rel-tv__lead">
          <div className="rel-tv__film">
            {title}
            {year ? <span>{year}</span> : null}
          </div>
          <div className="rel-tv__note">
            {qualityMissed && quality
              ? `Раздач в качестве «${qualityLabel(quality)}» не нашлось — выберите из того, что есть`
              : `Найдено раздач: ${shownAll.length} · скорость зависит от числа сидов, а не от вашего интернета`}
          </div>
        </div>
      )}
      {stage === "list" && (
        <div className="rel-tv__filters">
          <Focusable as="button" className="rel-tv__chip" focusKey="rel:f:seeds" scroll={false} onPress={() => {
            setMinSeeds((v) => MIN_SEEDS[(MIN_SEEDS.indexOf(v) + 1) % MIN_SEEDS.length]);
            chipPressed("rel:f:seeds");
          }}>
            {minSeeds ? `Сидов от ${minSeeds}` : "Любые сиды"}
          </Focusable>
          <Focusable as="button" className="rel-tv__chip" focusKey="rel:f:voice" scroll={false} onPress={() => {
            setVoice((v) => VOICES[(VOICES.indexOf(v) + 1) % VOICES.length]);
            chipPressed("rel:f:voice");
          }}>
            {voice === "any" ? "Любая озвучка" : voice}
          </Focusable>
          {seasonOptions.length >= 2 && (
            <Focusable
              as="button"
              className="rel-tv__chip"
              focusKey="rel:f:season"
              scroll={false}
              onPress={() => {
                const order = [0, ...seasonOptions];
                setSeason((v) => order[(Math.max(0, order.indexOf(v)) + 1) % order.length]);
                chipPressed("rel:f:season");
              }}
            >
              {season ? `Сезон ${season}` : "Любой сезон"}
            </Focusable>
          )}
          <Focusable as="button" className="rel-tv__chip" focusKey="rel:f:sort" scroll={false} onPress={() => {
            setSort((v) => SORTS[(SORTS.indexOf(v) + 1) % SORTS.length]);
            chipPressed("rel:f:sort");
          }}>
            Сортировка {SORT_LABEL[sort]}
          </Focusable>
        </div>
      )}
      <div className="rel-tv__list">
        {(stage === "searching" || stage === "connecting") && (
          <div className="links-tv__wait">
            <Spinner />
            <span className="links-tv__text">
              {stage === "searching" ? (quality ? `Ищу раздачу ${qualityLabel(quality)}…` : "Ищу раздачи…") : resuming ? "Открываю сохранённую раздачу…" : "Получаю файлы раздачи от пиров…"}
            </span>
          </div>
        )}
        {stage === "error" && (
          <>
            <p className="links-tv__text">{error}</p>
            {releases.length > 0 && (
              <Focusable back as="button" className="links-tv__row" focusKey="release:back" autoFocus scroll={false} onPress={() => setStage("list")}>
                <span className="links-tv__name">К списку раздач</span>
                <NextIcon size={20} />
              </Focusable>
            )}
          </>
        )}
        {stage === "list" &&
          visible.map((r, i) => {
            const need = neededMbit(r.size, durationMin);
            const seeds = r.seeds ?? 0;
            const few = seeds < FEW_SEEDS;
            const tags = parseTags(r.name);
            const labels = tagLabels({ ...tags, quality: undefined });
            const tier = tags.quality === "4K" ? "4k" : tags.quality === "1080p" ? "fhd" : tags.quality === "720p" ? "hd" : tags.quality === "SD" ? "sd" : "none";
            return (
              <div className="rel-tv__item" key={r.provider + r.id}>
                <Focusable as="button" focusKey={`release:${i}`} className="rel-tv__row" onPress={() => void pick(r)} autoFocus={i === 0 && !filtersUsed}>
                  <span className={`rel-tv__badge rel-tv__badge--${tier}`}>{tags.quality ?? "?"}</span>
                  <span className="rel-tv__main">
                    <span className="rel-tv__title">{r.name}</span>
                    {(labels.length > 0 || r.id === bestId) && (
                      <span className="rel-tv__tags">
                        {r.id === bestId && <i className="rel-tv__best">★ лучший выбор</i>}
                        {labels.map((t) => (
                          <i key={t}>{t}</i>
                        ))}
                      </span>
                    )}
                    <span className="rel-tv__meta">
                      <span>{r.size ?? "—"}</span>
                      {need && <span>≈ {need < 10 ? need.toFixed(1) : Math.round(need)} Мбит/с</span>}
                      <span>{r.provider}</span>
                      {few && <span className="release-warn">мало сидов — возможна буферизация</span>}
                      {!few && !fits(r) && <span className="release-warn">может не хватить скорости интернета</span>}
                    </span>
                  </span>
                  <span className={`rel-tv__seeds ${few ? "rel-tv__seeds--few" : ""}`}>
                    <b>{seeds}</b>
                    <small>сидов</small>
                  </span>
                </Focusable>
                <Focusable as="button" className="rel-tv__info" focusKey={`release:${i}:info`} aria-label="Что внутри раздачи" scroll={false} onPress={() => void inspect(r)}>
                  <AboutIcon size={22} />
                </Focusable>
              </div>
            );
          })}
        {stage === "list" && visible.length === 0 && shownAll.length > 0 && (
          <p className="links-tv__text">Под выбранные фильтры раздач нет — ослабьте их выше.</p>
        )}
        {stage === "list" && hidden.length > 0 && !showHidden && (
          <Focusable as="button" className="links-tv__row links-tv__row--close" focusKey="release:show-hidden" scroll={false} onPress={() => setShowHidden(true)}>
            <span className="links-tv__name">Показать ещё {hidden.length} — с другим годом</span>
          </Focusable>
        )}
        {stage === "inspect" && inspecting && (
          <>
            <p className="links-tv__text">{inspecting.name}</p>
            {!probe && !probeError && (
              <div className="links-tv__wait">
                <Spinner />
                <span className="links-tv__text">Читаю начало файла раздачи…</span>
              </div>
            )}
            {probeError && <p className="links-tv__text">{probeError}</p>}
            {probe && (
              <div className="rel-tv__probe">
                {probe.file && <div className="rel-tv__probe-file">{probe.file}{probe.duration > 0 ? ` · ${Math.round(probe.duration / 60)} мин` : ""}</div>}
                {(["video", "audio", "sub"] as const).map((kind) => {
                  const list = probe.tracks.filter((t) => t.kind === kind);
                  return (
                    <div className="rel-tv__probe-group" key={kind}>
                      <div className="rel-tv__probe-head">{kind === "video" ? "Видео" : kind === "audio" ? "Звук" : "Субтитры"}</div>
                      {list.length === 0 && <div className="rel-tv__probe-line rel-tv__probe-line--none">{kind === "sub" ? "нет вшитых субтитров" : "нет"}</div>}
                      {list.map((t, n) => (
                        <div className="rel-tv__probe-line" key={n}>
                          {[t.lang && t.lang.toUpperCase(), t.title, t.codec, t.detail].filter(Boolean).join(" · ") || "без описания"}
                          {t.default && <i>по умолчанию</i>}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
            <Focusable as="button" className="links-tv__row links-tv__row--center" focusKey="release:inspect:go" scroll={false} autoFocus onPress={() => void pick(inspecting)}>
              <span className="links-tv__name">{download ? "Скачать эту раздачу" : "Смотреть эту раздачу"}</span>
            </Focusable>
            <Focusable as="button" back className="links-tv__row links-tv__row--close" focusKey="release:inspect:back" scroll={false} onPress={() => setStage("list")}>
              <span className="links-tv__name">К списку раздач</span>
            </Focusable>
          </>
        )}
        {stage === "files" &&
          files?.choices.map((f, i) => {
            const key = episodeKey(f);
            const e = useEpisodeProgress.getState().entry(filmId, key);
            const next = smartFile && smartFile.id === f.id;
            const label = episodeLabel(key, f.name);
            return (
              <Focusable
                key={f.id}
                as="button"
                focusKey={`file:${i}`}
                className="rel-tv__row"
                autoFocus={smartFile ? next : i === 0}
                onPress={() => void play(files.link, files.hash, `${files.name} — ${f.name}`, f, files.choices).catch(fail)}
              >
                <span className="rel-tv__title">
                  {label}
                  {next && <span className="ep-tag"> · далее</span>}
                </span>
                <span className="rel-tv__meta">
                  {e?.watched && <span className="ep-done">✓ просмотрено</span>}
                  {e && !e.watched && e.position / e.duration >= 0.02 && <span>{Math.round((e.position / e.duration) * 100)}%</span>}
                  {label !== f.name && <span>{f.name}</span>}
                  <span>{formatBytes(f.length)}</span>
                </span>
              </Focusable>
            );
          })}
      </div>
    </Modal>
  );
}
