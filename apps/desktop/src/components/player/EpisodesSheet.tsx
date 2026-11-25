import { useEffect, useMemo, useState } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { Focusable } from "@kinonyx/ui";
import { kpSeasons, type TorrentFile } from "../../data/api";
import { episodeKey } from "../../data/episodes";
import { useEpisodeProgress } from "../../store/episodeProgress";
import { KxSheet, KxTabs, type KxTab } from "./PlayerSheet";
import { KxCheck, KxEpisodes } from "./PlayerIcons";

/** One file of the release, with what its name says about it. `index` is its place in `episodes.files`. */
export interface EpisodeItem {
  index: number;
  file: TorrentFile;
  key: string;
  season: number | null;
  episode: number | null;
}

export interface EpisodeGroup {
  /** "s2" for a season, "other" for files whose season isn't known. */
  key: string;
  label: string;
  items: EpisodeItem[];
}

/**
 * Splits the release's files into seasons by `episodeKey` (S02E03 → season 2, episode 3; E03 → an episode without a
 * season). Seasons go in order, the files without a season last; inside a group the files keep the release's order.
 * One group (or none known) means one plain list.
 */
export function groupEpisodes(files: TorrentFile[]): EpisodeGroup[] {
  const items: EpisodeItem[] = files.map((file, index) => {
    const key = episodeKey(file);
    const full = key.match(/^S(\d+)E(\d+)$/);
    const only = key.match(/^E(\d+)$/);
    return {
      index,
      file,
      key,
      season: full ? Number(full[1]) : null,
      episode: full ? Number(full[2]) : only ? Number(only[1]) : null,
    };
  });
  const seasons = new Map<number, EpisodeItem[]>();
  const other: EpisodeItem[] = [];
  for (const it of items) {
    if (it.season == null) other.push(it);
    else {
      const list = seasons.get(it.season);
      if (list) list.push(it);
      else seasons.set(it.season, [it]);
    }
  }
  const groups: EpisodeGroup[] = [...seasons.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, list]) => ({ key: `s${n}`, label: `Сезон ${n}`, items: list }));
  if (other.length) groups.push({ key: "other", label: groups.length ? "Без сезона" : "Серии", items: other });
  return groups;
}

interface EpisodeMeta {
  name?: string;
  date?: string;
}

/** Names and air dates of the episodes, when the metadata source has them (TMDB gives only the last and the next). */
function useEpisodeMeta(filmId: number | undefined): Map<string, EpisodeMeta> {
  const [meta, setMeta] = useState<Map<string, EpisodeMeta>>(() => new Map());
  useEffect(() => {
    if (!filmId) return;
    let alive = true;
    Promise.resolve(kpSeasons(filmId))
      .then((res) => {
        if (!alive) return;
        const m = new Map<string, EpisodeMeta>();
        for (const season of res?.items ?? []) {
          for (const e of season.episodes ?? []) {
            m.set(`${e.seasonNumber}:${e.episodeNumber}`, { name: e.nameRu || e.nameEn || undefined, date: e.releaseDate || undefined });
          }
        }
        setMeta(m);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [filmId]);
  return meta;
}

function formatDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * «Серии»: seasons as tabs (the one being watched opens first), each episode a card — the series' poster (there is
 * no frame of each episode), its number, a progress bar; the name and date when they are known. A press plays the
 * file at its own place in the release, so «next episode» keeps working.
 */
export function EpisodesSheet({
  files,
  current,
  filmId,
  poster,
  onPick,
  onClose,
}: {
  files: TorrentFile[];
  /** Index of the playing file in `files`. */
  current: number;
  filmId?: number;
  poster?: string;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const groups = useMemo(() => groupEpisodes(files), [files]);
  const currentGroup = groups.find((g) => g.items.some((it) => it.index === current))?.key ?? groups[0]?.key ?? "";
  const [tab, setTab] = useState(currentGroup);
  // The cards take the focus when the window opens, not when the remote walks along the tabs.
  const [autoFocusCards, setAutoFocusCards] = useState(true);
  const meta = useEpisodeMeta(filmId);
  const progress = useEpisodeProgress((s) => s.data);

  const shown = groups.find((g) => g.key === tab) ?? groups[0];
  const tabs: KxTab[] = groups.map((g) => ({ key: g.key, label: g.label }));
  const firstInTab = shown?.items.some((it) => it.index === current) ? current : shown?.items[0]?.index;

  return (
    <KxSheet
      focusKey="player:episodes"
      preferredChildFocusKey={firstInTab != null ? `ep:${firstInTab}` : undefined}
      title="Серии"
      icon={<KxEpisodes />}
      count={`${files.length}`}
      tabs={
        <KxTabs
          tabs={tabs}
          current={shown?.key ?? ""}
          prefix="eptab"
          onSelect={(key) => {
            setAutoFocusCards(false);
            setTab(key);
          }}
        />
      }
      onClose={onClose}
    >
      {shown?.items.map((it) => {
        const entry = filmId ? progress[filmId]?.episodes[it.key] : undefined;
        const m = it.season != null && it.episode != null ? meta.get(`${it.season}:${it.episode}`) : undefined;
        const isCurrent = it.index === current;
        const pct = entry && !entry.watched && entry.duration > 0 ? Math.round((entry.position / entry.duration) * 100) : 0;
        const title = m?.name ?? (it.episode != null ? `Серия ${it.episode}` : it.file.name);
        const status = isCurrent ? "Сейчас" : entry?.watched ? "Просмотрена" : pct >= 2 ? `${pct}%` : undefined;
        const line = [formatDate(m?.date), status].filter(Boolean).join(" · ");
        return (
          <Focusable
            key={it.file.id}
            as="button"
            className={`kx-ep ${isCurrent ? "is-selected" : ""}`}
            focusKey={`ep:${it.index}`}
            onPress={() => onPick(it.index)}
            autoFocus={autoFocusCards && it.index === firstInTab}
            scrollBlock="nearest"
            // A long season: → goes straight to «Закрыть» instead of walking down every card.
            onArrowPress={(direction) => {
              if (direction !== "right") return true;
              void setFocus("player:episodes:close");
              return false;
            }}
          >
            <span className={`kx-ep__thumb ${poster ? "" : "kx-ep__thumb--blank"}`} style={poster ? { backgroundImage: `url("${poster}")` } : undefined}>
              <span className="kx-ep__num">{it.episode ?? "•"}</span>
              {(isCurrent || pct >= 2) && <i className="kx-ep__progress" style={{ width: `${Math.max(pct, isCurrent ? 2 : 0)}%` }} />}
            </span>
            <span className="kx-ep__text">
              <span className="kx-ep__title" title={it.file.name}>
                {title}
              </span>
              {line && <span className={`kx-ep__meta ${isCurrent ? "kx-ep__meta--now" : ""}`}>{line}</span>}
            </span>
            {entry?.watched && !isCurrent && <KxCheck className="kx-ep__check" size={26} />}
          </Focusable>
        );
      })}
    </KxSheet>
  );
}
