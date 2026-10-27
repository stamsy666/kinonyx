import { useEffect, useRef, useState } from "react";
import { Focusable, NextIcon, Spinner, onBack } from "@kinonyx/ui";
import {
  openTorrent,
  parseSize,
  playableFiles,
  streamUrlFor,
  torApiSearchId,
  torApiSearchTitle,
  torrserveHealth,
  type TorApiRelease,
  type TorrentFile,
} from "../data/api";
import { useLastRelease, type LastRelease } from "../store/lastRelease";
import { episodeKey, episodeLabel } from "../data/episodes";
import { useEpisodeProgress } from "../store/episodeProgress";
import { splitByYear } from "../data/releaseFilter";
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

type Stage = "searching" | "list" | "connecting" | "files" | "error";

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
        if (stage === "files" || (stage === "error" && releases.length)) {
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
      if (year) {
        const withYear = await torApiSearchTitle(`${title} ${year}`, year).catch(() => []);
        if (withYear.length) return withYear;
      }
      return torApiSearchTitle(title, year);
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

  async function pick(release: TorApiRelease) {
    setStage("connecting");
    try {
      if (!(await torrserveHealth())) {
        throw new Error("TorrServer не запущен — он стартует вместе с приложением, проверьте binaries/ (см. CLAUDE.md)");
      }
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

  const heading = download ? (stage === "files" ? "Какую серию скачать" : "Что скачать") : stage === "files" ? "Выбор серии" : "Выбор раздачи";

  const visible = showHidden ? [...releases, ...hidden] : releases;

  return (
    <Modal focusKey="release-picker" preferredChildFocusKey="release:0" className="links-tv rel-tv" onClose={onClose}>
      <h3 className="links-tv__title">{heading}</h3>
      {stage === "list" && (
        <p className="links-tv__text">
          {qualityMissed && quality
            ? `Раздач в качестве «${qualityLabel(quality)}» не нашлось — выберите из того, что есть.`
            : `${year ? `«${title}», ${year}. ` : ""}Скорость зависит от числа сидов (▲) раздачи, а не от вашего интернета.`}
        </p>
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
            const few = (r.seeds ?? 0) < FEW_SEEDS;
            return (
              <Focusable
                key={r.provider + r.id}
                as="button"
                focusKey={`release:${i}`}
                className="rel-tv__row"
                onPress={() => void pick(r)}
                autoFocus={i === 0}
              >
                <span className="rel-tv__title">{r.name}</span>
                <span className="rel-tv__meta">
                  <span>{r.size ?? "—"}</span>
                  {need && <span>≈ {need < 10 ? need.toFixed(1) : Math.round(need)} Мбит/с</span>}
                  <span className={few ? "release-seeds release-seeds--few" : "release-seeds"}>▲ {r.seeds ?? 0}</span>
                  <span>▼ {r.peers ?? 0}</span>
                  <span>{r.provider}</span>
                  {few && <span className="release-warn">мало сидов — возможна буферизация</span>}
                </span>
              </Focusable>
            );
          })}
        {stage === "list" && hidden.length > 0 && !showHidden && (
          <Focusable as="button" className="links-tv__row links-tv__row--close" focusKey="release:show-hidden" scroll={false} onPress={() => setShowHidden(true)}>
            <span className="links-tv__name">Показать ещё {hidden.length} — с другим годом</span>
          </Focusable>
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
