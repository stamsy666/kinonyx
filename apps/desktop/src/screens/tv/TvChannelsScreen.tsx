import { useEffect, useMemo, useState } from "react";
import { nowNext, type Channel } from "@kinonyx/epg";
import { Focusable, FocusGroup, MicIcon, SearchIcon } from "@kinonyx/ui";
import { useApp } from "../../store/app";
import { useTv, UNGROUPED } from "../../store/tv";
import { TvScreenHeader } from "../../components/TvScreenHeader";
import { TextField } from "../../components/TextField";
import { ChannelTile } from "../../components/ChannelTile";
import { FocusHighlight } from "../../components/FocusHighlight";
import { VoiceSearchModal } from "../../components/VoiceSearchModal";
import { digitsFromWords, looseName } from "../../data/voiceText";

const TICK_MS = 30_000;

function useClock(interval: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

export function TvChannelsScreen({ group }: { group?: string }) {
  const playlist = useTv((s) => s.playlist);
  const epg = useTv((s) => s.epg);
  const programmesFor = useTv((s) => s.programmesFor);
  const lastChannelFocus = useTv((s) => s.lastChannelFocus);
  const setLastChannelFocus = useTv((s) => s.setLastChannelFocus);
  const navigate = useApp((s) => s.navigate);
  const back = useApp((s) => s.back);
  const [query, setQuery] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
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

  const title = !group ? "Все каналы" : group === UNGROUPED ? "Без категории" : group;
  const open = (c: Channel) => {
    setLastChannelFocus(groupKey, `ch:${c.id}`);
    navigate({ name: "tv-player", channelId: c.id });
  };
  const rememberedChannelExists = channels.some((c) => `ch:${c.id}` === rememberedChannelFocus);

  return (
    <FocusGroup focusKey="screen:channels" className="screen">
      <TvScreenHeader title={title} onBack={() => back()} onSettings={() => navigate({ name: "settings" })} />
      <div className="row screen__search">
        <TextField
          focusKey="ch:search"
          type="search"
          value={query}
          onChange={setQuery}
          placeholder="Поиск по каналам"
          icon={<SearchIcon />}
          className="field--grow"
        />
        <Focusable as="button" className="icon-btn" focusKey="ch:voice" onPress={() => setVoiceOpen(true)} scroll={false}>
          <MicIcon />
        </Focusable>
      </div>
      <div className="screen__body">
        {channels.length === 0 ? (
          <div className="empty">Ничего не найдено.</div>
        ) : (
          <div className="grid grid--channels">
            <FocusHighlight />
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
