import { useEffect, useState, type CSSProperties } from "react";
import { DiceIcon, Focusable, GearIcon, SearchIcon } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { FullscreenButton } from "./FullscreenButton";
import { WhatToWatchModal } from "./WhatToWatchModal";
import logoMark from "../assets/logo-mark.png";

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000 * 15);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function TopBar() {
  const now = useClock();
  const navigate = useApp((s) => s.navigate);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const [wtwOpen, setWtwOpen] = useState(false);
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const date = now.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <header className="topbar">
      <div className="topbar__clock">
        <span>{time}</span>
        <span style={{ opacity: 0.5 }}>{date}</span>
      </div>
      <button className="topbar__logo" onClick={() => navigate({ name: "home" })}>
        <img className="topbar__logo-mark" src={logoMark} alt="" />
        <span>
          KINON<em>YX</em>
        </span>
      </button>
      <div className="topbar__actions">
        <Focusable as="button" className="icon-btn" focusKey="hdr:menu" onPress={toggleSidebar} scroll={false}>
          <span style={{ display: "block", width: 18 }}>
            <span style={barStyle} />
            <span style={{ ...barStyle, margin: "5px 0" }} />
            <span style={barStyle} />
          </span>
        </Focusable>
        <Focusable as="button" className="icon-btn" focusKey="hdr:wtw" onPress={() => setWtwOpen(true)} scroll={false}>
          <DiceIcon />
        </Focusable>
        <Focusable as="button" className="icon-btn" focusKey="hdr:search" onPress={() => navigate({ name: "search" })} scroll={false}>
          <SearchIcon />
        </Focusable>
        <FullscreenButton />
        <Focusable
          as="button"
          className="icon-btn"
          focusKey="hdr:settings"
          onPress={() => navigate({ name: "settings" })}
          scroll={false}
        >
          <GearIcon />
        </Focusable>
      </div>
      {wtwOpen && (
        <WhatToWatchModal
          onClose={() => setWtwOpen(false)}
          onOpenFilm={(film) => {
            setWtwOpen(false);
            navigate({ name: "movie", id: film.kinopoiskId, preview: film });
          }}
        />
      )}
    </header>
  );
}

const barStyle: CSSProperties = {
  display: "block",
  height: 2,
  background: "currentColor",
  borderRadius: 1,
};
