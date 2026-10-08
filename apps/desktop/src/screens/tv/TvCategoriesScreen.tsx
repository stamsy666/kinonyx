import { useMemo } from "react";
import { Focusable, FocusGroup } from "@kinonyx/ui";
import { useApp } from "../../store/app";
import { useTv, UNGROUPED } from "../../store/tv";
import { TvScreenHeader } from "../../components/TvScreenHeader";
import { FocusHighlight } from "../../components/FocusHighlight";

import { cleanGroupName } from "../../data/groupName";

export function TvCategoriesScreen() {
  const playlist = useTv((s) => s.playlist);
  const epgStatus = useTv((s) => s.epgStatus);
  const lastCategoryFocus = useTv((s) => s.lastCategoryFocus);
  const setLastCategoryFocus = useTv((s) => s.setLastCategoryFocus);
  const navigate = useApp((s) => s.navigate);
  const back = useApp((s) => s.back);

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

  const epgHint = epgStatus === "loading" ? "Загружаем программу передач…" : epgStatus === "error" ? "Программа передач недоступна" : undefined;
  const rememberedCategoryExists = rows.some((row) => `cat:${row.key || UNGROUPED}` === lastCategoryFocus);

  return (
    <FocusGroup focusKey="screen:categories" className="screen">
      <TvScreenHeader
        eyebrow={epgHint}
        title="Категории плейлиста"
        subtitle={`Все каналы · ${playlist?.channels.length ?? 0}`}
        onBack={() => back()}
        onSettings={() => navigate({ name: "settings" })}
      />
      <div className="screen__body">
        <div className="grid grid--categories stagger">
          <FocusHighlight />
          {rows.map((r, i) => {
            const focusKeyStr = `cat:${r.key || UNGROUPED}`;
            return (
              <Focusable
                key={r.key || UNGROUPED}
                className="tile category-row"
                focusKey={focusKeyStr}
                autoFocus={rememberedCategoryExists ? focusKeyStr === lastCategoryFocus : i === 0}
                onPress={() => {
                  setLastCategoryFocus(focusKeyStr);
                  navigate({ name: "tv-channels", group: r.key || UNGROUPED });
                }}
              >
                <span className="category-row__name">{cleanGroupName(r.name)}</span>
                <span className="category-row__count">{r.count}</span>
              </Focusable>
            );
          })}
        </div>
      </div>
    </FocusGroup>
  );
}
