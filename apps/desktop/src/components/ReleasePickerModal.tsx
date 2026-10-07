import { useEffect, useRef, useState } from "react";
import { Focusable, Spinner, onBack } from "@kinonyx/ui";
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
import { Modal } from "./Modal";
import { FocusHighlight } from "./FocusHighlight";

interface Props {
  filmId: number;
  title: string;
  year?: number;
  /** Film length — lets each release show the download speed it needs to play smoothly. */
  durationMin?: number;
  /** A previously-picked release for this film — if set, skips straight to reconnecting
   *  to it instead of a fresh title search, falling back to the normal search on failure. */
  remembered?: LastRelease;
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

export function ReleasePickerModal({ filmId, title, year, durationMin, remembered, onClose, onReady }: Props) {
  // A remembered release skips the search entirely and tries to reconnect straight away —
  // only a search-stage mount (nothing remembered, or the reconnect below failed) runs the
  // title search effect.
  const [stage, setStage] = useState<Stage>(remembered ? "connecting" : "searching");
  const [resuming, setResuming] = useState(!!remembered);
  const [releases, setReleases] = useState<TorApiRelease[]>([]);
  const [files, setFiles] = useState<{ hash: string; name: string; link: string; choices: TorrentFile[] } | null>(null);
  const [error, setError] = useState<string>("");
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
        const file = torrent.files.find((f) => f.id === remembered.fileId) ?? torrent.files.find((f) => f.path === remembered.filePath);
        if (!file) throw new Error("Файл не найден в раздаче");
        const { choices } = playableFiles(torrent.files);
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
    torApiSearchTitle(title, year)
      .then((list) => {
        if (cancelled) return;
        list.sort((a, b) => (b.seeds ?? 0) - (a.seeds ?? 0));
        setReleases(list);
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
      } else {
        setFiles({ hash: torrent.hash, name, link, choices });
        setStage("files");
      }
    } catch (e) {
      fail(e);
    }
  }

  const heading = stage === "files" ? "Выбор серии" : "Выбор раздачи";

  return (
    <Modal focusKey="release-picker" preferredChildFocusKey="release:0" onClose={onClose}>
      <div className="modal-panel__header">
        <h3>{heading}</h3>
        <Focusable as="button" className="icon-btn" focusKey="release:close" onPress={onClose} scroll={false}>
          ×
        </Focusable>
      </div>
      <div className="modal-panel__list">
        <FocusHighlight pad={0} radius="var(--radius-sm)" />
        {(stage === "searching" || stage === "connecting") && (
          <div style={{ display: "grid", placeItems: "center", padding: "40px 0", gap: 14 }}>
            <Spinner />
            <span className="modal-status">
              {stage === "searching" ? "Ищу раздачи…" : resuming ? "Открываю сохранённую раздачу…" : "Получаю файлы раздачи от пиров…"}
            </span>
          </div>
        )}
        {stage === "error" && (
          <div className="stack" style={{ gap: 6 }}>
            <p className="empty" style={{ paddingBottom: 6 }}>{error}</p>
            {releases.length > 0 && (
              <Focusable as="button" className="btn" focusKey="release:back" autoFocus scroll={false} onPress={() => setStage("list")}>
                К списку раздач
              </Focusable>
            )}
          </div>
        )}
        {stage === "list" && (
          <p className="release-note">Скорость зависит от числа сидов раздачи, а не от вашего интернета. Выбирайте раздачи с большим ▲.</p>
        )}
        {stage === "list" &&
          releases.map((r, i) => {
            const need = neededMbit(r.size, durationMin);
            const few = (r.seeds ?? 0) < FEW_SEEDS;
            return (
              <Focusable
                key={r.provider + r.id}
                as="button"
                focusKey={`release:${i}`}
                className="list-option"
                onPress={() => void pick(r)}
                autoFocus={i === 0}
              >
                <span className="list-option__title">{r.name}</span>
                <span className="list-option__hint">
                  <span>{r.size ?? "—"}</span>
                  {need && <span>нужно ≈ {need < 10 ? need.toFixed(1) : Math.round(need)} Мбит/с</span>}
                  <span className={few ? "release-seeds release-seeds--few" : "release-seeds"}>▲ {r.seeds ?? 0}</span>
                  <span>▼ {r.peers ?? 0}</span>
                  <span>{r.provider}</span>
                  {few && <span className="release-warn">мало сидов — возможна буферизация</span>}
                </span>
              </Focusable>
            );
          })}
        {stage === "files" &&
          files?.choices.map((f, i) => (
            <Focusable
              key={f.id}
              as="button"
              focusKey={`file:${i}`}
              className="list-option"
              autoFocus={i === 0}
              onPress={() => void play(files.link, files.hash, `${files.name} — ${f.name}`, f, files.choices).catch(fail)}
            >
              <span className="list-option__title">{f.name}</span>
              <span className="list-option__hint">
                <span>{formatBytes(f.length)}</span>
                {f.path.includes("/") && <span>{f.path.split("/").slice(0, -1).join(" / ")}</span>}
              </span>
            </Focusable>
          ))}
      </div>
    </Modal>
  );
}
