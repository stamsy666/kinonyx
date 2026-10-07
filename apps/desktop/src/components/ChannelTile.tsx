import { memo, useState } from "react";
import type { Channel, NowNext } from "@kinonyx/epg";
import { Focusable } from "@kinonyx/ui";

interface ChannelTileProps {
  channel: Channel;
  nowNext?: NowNext;
  onOpen: (channel: Channel) => void;
  autoFocus?: boolean;
}

function initialsOf(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export const ChannelTile = memo(function ChannelTile({ channel, nowNext, onOpen, autoFocus }: ChannelTileProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  const showLogo = channel.logo && !logoFailed;
  const now = nowNext?.now;

  return (
    <Focusable className="tile channel-tile" focusKey={`ch:${channel.id}`} autoFocus={autoFocus} onPress={() => onOpen(channel)}>
      <div className="channel-tile__logo">
        {showLogo ? (
          <img src={channel.logo} alt="" loading="lazy" decoding="async" onError={() => setLogoFailed(true)} />
        ) : (
          <span className="channel-tile__initials">{initialsOf(channel.name)}</span>
        )}
      </div>
      <div className="channel-tile__name" title={channel.name}>
        {channel.name}
      </div>
      {/* No `nowNext` at all (e.g. the Home "Избранные каналы" shelf, which doesn't load
          the channel's playlist just to show this) means there's no guide data to show —
          an empty subtitle line + a 0%-filled progress track still reserved that space,
          leaving a dead gap under the name inside the focus ring. */}
      {nowNext && (
        <>
          <div className="channel-tile__now">{now?.title ?? (nowNext.next ? `далее: ${nowNext.next.title}` : "")}</div>
          <div className="channel-tile__progress">
            <i style={{ width: `${Math.round((nowNext.progress ?? 0) * 100)}%` }} />
          </div>
        </>
      )}
    </Focusable>
  );
});
