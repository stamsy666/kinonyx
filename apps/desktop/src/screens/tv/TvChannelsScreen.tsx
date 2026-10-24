import { useEffect, useMemo, useState } from "react";
import { nowNext, type Channel, type Programme } from "@kinonyx/epg";
import { CarouselIcon, Focusable, FocusGroup, HomeIcon, MicIcon, SearchIcon } from "@kinonyx/ui";
import { useApp } from "../../store/app";
import { useTv, UNGROUPED } from "../../store/tv";
import { HomeChrome } from "../../components/HomeChrome";
import { useHomeFeel } from "../../components/useHomeFeel";
import { TextField } from "../../components/TextField";
import { ChannelTile } from "../../components/ChannelTile";
import { ChannelCarousel } from "../../components/ChannelCarousel";
import { VoiceSearchModal } from "../../components/VoiceSearchModal";
import { digitsFromWords, looseName } from "../../data/voiceText";
import { fadeThrough } from "../../data/transition";

const TICK_MS = 30_000;
const LAYOUT_KEY = "kinonyx.channelsLayout";
type Layout = "grid" | "carousel";

function readLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "carousel" ? "carousel" : "grid";
  } catch {
    return "grid";
  }
}

function useClock(interval: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

import { cleanGroupName } from "../../data/groupName";

export function TvChannelsScreen({ group }: { group?: string }) {
  const playlist = useTv((s) => s.playlist);
  const epg = useTv((s) => s.epg);
  const programmesFor = useTv((s) => s.programmesFor);
  const lastChannelFocus = useTv((s) => s.lastChannelFocus);
  const setLastChannelFocus = useTv((s) => s.setLastChannelFocus);
  const navigate = useApp((s) => s.navigate);
  useHomeFeel(null);
  const [query, setQuery] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  // "Сетка" (default) or "Карусель" — the viewer's choice, remembered.
  const [layout, setLayout] = useState<Layout>(readLayout);
  const toggleLayout = () => {
    const next: Layout = layout === "grid" ? "carousel" : "grid";
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      /* the choice just won't survive a restart */
    }
  };
  const now = useClock(TICK_MS);
  const groupKey = group ?? "*";
  const rememberedChannelFocus = lastChannelFocus[groupKey];

  const channels = useMemo(() => {
    if (!playlist) return [];
    let list = playlist.channels;
    if (group === UNGROUPED) list = list.filter((c) => !c.group);
    else if (group) list = list.filter((c) => c.group === group);
    const q = looseName(query);
    if (q) list = list.filter((c) => looseName(c.name).includes(q));
    return list;
  }, [playlist, group, query]);

  const guide = useMemo(() => {
    if (!epg) return new Map<string, ReturnType<typeof nowNext>>();
    const map = new Map<string, ReturnType<typeof nowNext>>();
    for (const c of channels) map.set(c.id, nowNext(programmesFor(c), now));
    return map;
  }, [epg, channels, programmesFor, now]);

  const title = !group ? "Все каналы" : group === UNGROUPED ? "Без категории" : cleanGroupName(group);
  const open = (c: Channel, programme?: Programme) => {
    setLastChannelFocus(groupKey, `ch:${c.id}`);
    fadeThrough(() => navigate({ name: "tv-player", channelId: c.id, programme }));
  };
  const rememberedChannelExists = channels.some((c) => `ch:${c.id}` === rememberedChannelFocus);

  return (
    <FocusGroup focusKey="screen:channels" className="screen-pad home home--tv home--nohero ctv">
      <HomeChrome
        id="tvch"
        label={title}
        hideSearch
        extra={
          <>
            <Focusable as="button" className="home-round" focusKey="ch:voice" onPress={() => setVoiceOpen(true)} scroll={false}>
              <MicIcon />
            </Focusable>
            <Focusable as="button" className="home-round" focusKey="ch:layout" onPress={toggleLayout} scroll={false}>
              {layout === "grid" ? <CarouselIcon /> : <HomeIcon />}
            </Focusable>
          </>
        }
      />
      <div className="home__rows">
        <div className="ctv__search">
          <TextField
            focusKey="ch:search"
            type="search"
            value={query}
            onChange={setQuery}
            placeholder="Поиск по каналам"
            icon={<SearchIcon />}
            className="field--grow"
          />
        </div>
        {channels.length === 0 ? (
          <div className="empty">Ничего не найдено.</div>
        ) : layout === "carousel" ? (
          <div className="ctv__carousel">
            <ChannelCarousel key={query} channels={channels} guide={guide} programmesFor={programmesFor} now={now} onOpen={open} startKey={query ? undefined : rememberedChannelFocus} />
          </div>
        ) : (
          <div className="grid grid--channels">
            {channels.map((c, i) => {
              const autoFocus = query ? i === 0 : rememberedChannelExists ? `ch:${c.id}` === rememberedChannelFocus : i === 0;
              return <ChannelTile key={c.id} channel={c} nowNext={guide.get(c.id)} onOpen={open} autoFocus={autoFocus} />;
            })}
          </div>
        )}
      </div>
      {voiceOpen && (
        <VoiceSearchModal
          subject="канала"
          onClose={() => setVoiceOpen(false)}
          onResult={(text) => {
            setVoiceOpen(false);
            setQuery(digitsFromWords(text));
          }}
        />
      )}
    </FocusGroup>
  );
}
