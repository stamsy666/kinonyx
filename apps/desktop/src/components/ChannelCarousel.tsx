import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { isWithinCatchupWindow, type Channel, type NowNext, type Programme } from "@kinonyx/epg";
import { Focusable, onBack } from "@kinonyx/ui";

// Keep in sync with --cover-s / --cover-gap in tv.css: the strip is positioned by arithmetic
// (the focused cover is wider than the rest, so measuring would chase a moving target).
const COVER_SMALL = 132;
const COVER_GAP = 14;
const STEP = COVER_SMALL + COVER_GAP;
const FUTURE_ROWS = 12;
const PAST_ROWS = 40;
const ZONE_KEY = "sch:zone";

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

function initialsOf(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

const Cover = memo(function Cover({
  channel,
  index,
  isCurrent,
  hasSchedule,
  onFocused,
  onOpen,
  autoFocus,
}: {
  channel: Channel;
  index: number;
  isCurrent: boolean;
  /** Whether "down" can step into the schedule zone. */
  hasSchedule: boolean;
  onFocused: (index: number) => void;
  onOpen: (c: Channel) => void;
  autoFocus: boolean;
}) {
  const [failed, setFailed] = useState(false);
  // Whether this cover was the focused one when the press began: a click on any other cover
  // only brings it under the frame, a press on the focused one opens the channel.
  const wasFocused = useRef(false);
  return (
    <Focusable
      className={`ch-cover ${isCurrent ? "is-current" : ""}`}
      focusKey={`ch:${channel.id}`}
      autoFocus={autoFocus}
      scroll={false}
      hoverFocus={false}
      onArrowPress={(direction) => {
        if (direction === "down") {
          if (hasSchedule) setFocus(ZONE_KEY);
          return false;
        }
        return true;
      }}
      onFocus={() => {
        onFocused(index);
      }}
      onPress={() => {
        if (wasFocused.current) onOpen(channel);
      }}
    >
      {(focused) => {
        wasFocused.current = focused;
        return channel.logo && !failed ? (
          <img src={channel.logo} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
        ) : (
          <span className="ch-cover__initials">{initialsOf(channel.name)}</span>
        );
      }}
    </Focusable>
  );
});

/** Shown instead of the schedule when there is nothing to list. */
function NoGuide({ loaded }: { loaded: boolean }) {
  return (
    <div className="ch-empty">
      <svg className="ch-empty__icon" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
        <path d="M9.5 14.5l5 4M14.5 14.5l-5 4" />
      </svg>
      <div className="ch-empty__title">{loaded ? "Нет данных о передачах" : "Программа передач не загружена"}</div>
      <div className="ch-empty__hint">
        {loaded ? "Для этого канала в программе передач ничего не нашлось." : "Расписание появится, как только загрузится программа передач плейлиста."}
      </div>
    </div>
  );
}

/**
 * "Карусель" layout of a channel list, after the PlayStation 4 home screen: one row of covers,
 * the focused one grows inside a fixed, animated frame one cover in from the left edge, the
 * row slides under the frame; the channel's name and its schedule are set underneath.
 *
 * The schedule is one zone. "Down" from the covers focuses the whole zone; Enter works inside it
 * (rows get their own focus: up to what has aired, down to what is coming, Enter plays), and
 * Back leaves it for the covers in one press. An aired programme opens the channel at that
 * programme (archive); the one on air opens it live.
 */
export function ChannelCarousel({
  channels,
  guide,
  programmesFor,
  now,
  onOpen,
  startKey,
}: {
  channels: Channel[];
  guide: Map<string, NowNext>;
  programmesFor: (c: Channel) => Programme[] | undefined;
  /** Current time (ms), ticking — decides which programme is on. */
  now: number;
  /** `programme` is set when an aired programme was picked (catch-up), absent for live. */
  onOpen: (c: Channel, programme?: Programme) => void;
  /** Focus key to start on (the remembered channel), else the first. */
  startKey?: string;
}) {
  const strip = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  // The schedule must end inside the window at any UI zoom: its height is whatever is left
  // under the channel name (at least a few rows); beyond that it scrolls inside itself.
  const fitPanel = useCallback(() => {
    const el = panel.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    el.style.maxHeight = `${Math.max(132, Math.floor(window.innerHeight - top - 30))}px`;
  }, []);
  useLayoutEffect(() => {
    fitPanel();
    const ro = new ResizeObserver(fitPanel);
    ro.observe(document.documentElement);
    window.addEventListener("resize", fitPanel);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fitPanel);
    };
  });
  const startIndex = Math.max(0, channels.findIndex((c) => `ch:${c.id}` === startKey));
  const [current, setCurrent] = useState(startIndex);
  const channel = channels[Math.min(current, channels.length - 1)];
  const nn = guide.get(channel.id);
  // Inside the schedule (rows focusable) or not (the schedule is one zone to step onto).
  const [active, setActive] = useState(false);

  const all = programmesFor(channel) ?? [];
  const canArchive = Boolean(channel.catchup);
  const past = canArchive ? all.filter((p) => p.stop <= now && isWithinCatchupWindow(channel.catchup, p.start, now)).slice(-PAST_ROWS) : [];
  const ahead = all.filter((p) => p.stop > now).slice(0, FUTURE_ROWS);
  const rows = [...past, ...ahead];
  const nowRow = ahead.find((p) => p.start <= now);
  const enterKey = nowRow ? `sch:${nowRow.start}` : ahead[0] ? `sch:${ahead[0].start}` : rows[0] ? `sch:${rows[0].start}` : undefined;

  // The list opens with the programme on air in SECOND place: one aired programme above it shows
  // that there is an archive to scroll up to. Runs when the channel changes and when the rows
  // (re)appear — the guide often arrives after the screen.
  const nowStart = nowRow?.start;
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || el.querySelector(".ch-sched.is-focused")) return; // never yank the list from under a focus
    const list = [...el.querySelectorAll<HTMLElement>(".ch-sched")];
    let i = list.findIndex((r) => r.classList.contains("is-now"));
    if (i < 0) i = list.findIndex((r) => !r.classList.contains("is-past"));
    if (i < 0) return;
    const target = list[Math.max(0, i - 1)];
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - 6;
  }, [channel.id, rows.length, nowStart]);

  // Entering the schedule: put the focus on the programme on air.
  useEffect(() => {
    if (active && enterKey) setFocus(enterKey);
  }, [active, enterKey]);

  // One Back press leaves the schedule (zone or rows) for the covers.
  const coverKey = `ch:${channel.id}`;
  const stateRef = useRef({ active, coverKey });
  stateRef.current = { active, coverKey };
  useEffect(
    () =>
      onBack(() => {
        const { active: a, coverKey: k } = stateRef.current;
        const inZone = !!document.querySelector(".ch-zone.is-focused, .ch-sched.is-focused");
        if (!a && !inZone) return false; // not ours: the screen goes back as usual
        setActive(false);
        setFocus(k);
        return true;
      }),
    [],
  );

  // The frame stands still; the row slides under it so the focused cover always lands in it.
  // The row glides, but it never queues: every step just re-aims the same glide (an exponential
  // ease toward the target, ~50 ms time constant), so holding the arrow stays right on the
  // current channel instead of trailing behind it.
  const target = useRef(0);
  const raf = useRef(0);
  const glide = useCallback(() => {
    if (raf.current) return;
    let last = performance.now();
    const tick = (t: number) => {
      const el = strip.current;
      if (!el) {
        raf.current = 0;
        return;
      }
      const k = 1 - Math.exp(-(t - last) / 50);
      last = t;
      const diff = target.current - el.scrollLeft;
      if (Math.abs(diff) < 0.6) {
        el.scrollLeft = target.current;
        raf.current = 0;
        return;
      }
      el.scrollLeft += diff * k;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const focused = useCallback(
    (i: number) => {
      setCurrent(i);
      setActive(false);
      target.current = i * STEP;
      glide();
    },
    [glide],
  );
  const wheelAt = useRef(0);

  const renderRow = (p: Programme, i: number) => {
    const onAir = p.start <= now && p.stop > now;
    const aired = p.stop <= now;
    const state = onAir ? "is-now" : aired ? "is-past" : "is-future";
    const content: ReactNode = (
      <>
        <span className="ch-sched__time">{hhmm(p.start)}</span>
        <div className="ch-sched__body">
          <div className="ch-sched__title">
            {onAir && <span className="ch-carousel__live">Сейчас</span>}
            <span className="ch-sched__name">{p.title}</span>
            {aired && <span className="ch-sched__tag">Архив</span>}
          </div>
          {onAir && (
            <div className="ch-carousel__progress">
              <i style={{ width: `${Math.round((nn?.progress ?? 0) * 100)}%` }} />
            </div>
          )}
          {onAir && p.desc && <p className="ch-carousel__desc">{p.desc}</p>}
        </div>
      </>
    );
    // Outside the schedule the rows are plain text: the zone around them is what takes the focus.
    if (!active) {
      return (
        <div key={p.start} className={`ch-sched ${state}`}>
          {content}
        </div>
      );
    }
    return (
      <Focusable
        key={p.start}
        className={`ch-sched ${state}`}
        focusKey={`sch:${p.start}`}
        scrollBlock="nearest"
        onArrowPress={(direction) => {
          // Up/down move between rows and stop at the ends; the way out is Back.
          if (direction === "up" && i === 0) return false;
          if (direction === "down" && i === rows.length - 1) return false;
          if (direction === "left" || direction === "right") return false;
          return true;
        }}
        onPress={() => {
          if (onAir) onOpen(channel);
          else if (aired) onOpen(channel, p);
        }}
      >
        {content}
      </Focusable>
    );
  };

  return (
    <div className="ch-carousel">
      <div className="ch-carousel__stage">
        {/* The fixed frame: it never moves, the covers slide into it. */}
        <div className="ch-frame" aria-hidden="true" />
        <div
          className="ch-carousel__strip"
          ref={(el) => {
            strip.current = el;
            // First paint: already slid to the starting channel, not scrolling in from the left.
            if (el && el.dataset.init !== "1") {
              el.dataset.init = "1";
              el.scrollLeft = startIndex * STEP;
            }
          }}
          onWheel={(e) => {
            // A mouse wheel steps the focus along the row (one channel per notch, not a flood).
            const t = performance.now();
            if (t - wheelAt.current < 90) return;
            wheelAt.current = t;
            const d = (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX) > 0 ? 1 : -1;
            const next = channels[Math.max(0, Math.min(channels.length - 1, current + d))];
            if (next) setFocus(`ch:${next.id}`, { byMouse: true }); // byMouse: it sounds like a navigation step
          }}
        >
          {channels.map((c, i) => (
            <Cover
              key={c.id}
              channel={c}
              index={i}
              isCurrent={i === current}
              hasSchedule={rows.length > 0}
              autoFocus={i === startIndex}
              onOpen={onOpen}
              onFocused={focused}
            />
          ))}
          <i className="ch-carousel__tail" />
        </div>
      </div>

      <div className="ch-carousel__info" key={channel.id} style={{ marginLeft: STEP }}>
        {channel.group && <div className="ch-carousel__group">{channel.group}</div>}
        <h2 className="ch-carousel__name">{channel.name}</h2>
      </div>

      {rows.length === 0 ? (
        <NoGuide loaded={!!nn} />
      ) : (
        <Focusable
          className={`ch-zone ${active ? "is-active" : ""}`}
          focusKey={ZONE_KEY}
          key={`z-${channel.id}`}
          scroll={false}
          onArrowPress={(direction) => {
            if (direction === "up") {
              setFocus(coverKey);
              return false;
            }
            return false; // nothing below or beside the schedule
          }}
          onPress={() => setActive(true)}
        >
          <div className="ch-carousel__panel" ref={panel}>
            {rows.map(renderRow)}
          </div>
        </Focusable>
      )}
    </div>
  );
}
