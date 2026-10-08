import { useEffect, useState } from "react";
import { Focusable } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { FullscreenButton } from "./FullscreenButton";
import { WhatToWatchModal } from "./WhatToWatchModal";
import logoMark from "../assets/logo-mark.png";
import { PopcornIcon, SearchLensIcon, SettingsCogIcon } from "./AnimatedIcons";

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
          {/* Three lines that draw themselves one after another on focus (menu-icon in theme.css). */}
          <svg className="menu-icon" width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
              <path d="M5 5h14" />
              <path d="M5 12h14" />
              <path d="M5 19h14" />
            </g>
          </svg>
        </Focusable>
        <Focusable as="button" className="icon-btn" focusKey="hdr:wtw" onPress={() => setWtwOpen(true)} scroll={false}>
          <PopcornIcon />
        </Focusable>
        <Focusable as="button" className="icon-btn" focusKey="hdr:search" onPress={() => navigate({ name: "search" })} scroll={false}>
          <SearchLensIcon />
        </Focusable>
        <FullscreenButton />
        <Focusable
          as="button"
          className="icon-btn"
          focusKey="hdr:settings"
          onPress={() => navigate({ name: "settings" })}
          scroll={false}
        >
          <SettingsCogIcon />
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

