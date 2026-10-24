import { useMemo } from "react";
import { Focusable, FocusGroup } from "@kinonyx/ui";
import { useApp } from "../../store/app";
import { useTv, UNGROUPED } from "../../store/tv";
import { HomeChrome } from "../../components/HomeChrome";
import { useHomeFeel } from "../../components/useHomeFeel";
import { cleanGroupName } from "../../data/groupName";

/** A colour of its own for each name, the same every time. */
function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** The categories of the opened playlist: coloured tiles like the film categories, "Все каналы" first. */
export function TvCategoriesScreen() {
  const playlist = useTv((s) => s.playlist);
  const epgStatus = useTv((s) => s.epgStatus);
  const lastCategoryFocus = useTv((s) => s.lastCategoryFocus);
  const setLastCategoryFocus = useTv((s) => s.setLastCategoryFocus);
  const navigate = useApp((s) => s.navigate);
  useHomeFeel(null);

  const rows = useMemo(() => {
    if (!playlist) return [];
    const counts = new Map<string, number>();
    let ungrouped = 0;
    for (const ch of playlist.channels) {
      if (ch.group) counts.set(ch.group, (counts.get(ch.group) ?? 0) + 1);
      else ungrouped++;
    }
    const list = playlist.groups.map((g) => ({ key: g, name: g, count: counts.get(g) ?? 0 }));
    if (ungrouped > 0) list.push({ key: "", name: "Без категории", count: ungrouped });
    return list;
  }, [playlist]);

  const total = playlist?.channels.length ?? 0;
  const epgHint = epgStatus === "loading" ? "Загружаем программу передач…" : epgStatus === "error" ? "Программа передач недоступна" : undefined;
  const rememberedCategoryExists = rows.some((row) => `cat:${row.key || UNGROUPED}` === lastCategoryFocus);

  return (
    <FocusGroup focusKey="screen:categories" className="screen-pad home home--tv home--nohero">
      <HomeChrome id="tvcat" label="Категории" hideSearch />
      <div className="home__rows">
        {epgHint && <p className="ctv__note">{epgHint}</p>}
        <div className="cats__tiles">
          <Focusable
            className="cats__tile ctv__tile"
            focusKey="cat:all"
            style={{ ["--tile-hue" as string]: 215 }}
            autoFocus={!rememberedCategoryExists}
            onPress={() => {
              setLastCategoryFocus("cat:all");
              navigate({ name: "tv-channels" });
            }}
          >
            <span className="ctv__count">{total}</span>
            <span className="cats__tile-name">Все каналы</span>
          </Focusable>
          {rows.map((r) => {
            const focusKeyStr = `cat:${r.key || UNGROUPED}`;
            return (
              <Focusable
                key={r.key || UNGROUPED}
                className="cats__tile ctv__tile"
                focusKey={focusKeyStr}
                style={{ ["--tile-hue" as string]: hueOf(r.name) }}
                autoFocus={focusKeyStr === lastCategoryFocus}
                onPress={() => {
                  setLastCategoryFocus(focusKeyStr);
                  navigate({ name: "tv-channels", group: r.key || UNGROUPED });
                }}
              >
                <span className="ctv__count">{r.count}</span>
                <span className="cats__tile-name">{cleanGroupName(r.name)}</span>
              </Focusable>
            );
          })}
        </div>
      </div>
    </FocusGroup>
  );
}
