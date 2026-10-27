import type { ReactNode } from "react";
import { BackIcon, cancelGlides, Focusable } from "@kinonyx/ui";
import { SearchLensIcon } from "./AnimatedIcons";
import { FullscreenButton } from "./FullscreenButton";
import { NoticeBell } from "./NoticeBell";
import { useApp } from "../store/app";
import logoMark from "../assets/logo-mark.png";

/**
 * The top row of the Apple TV-style pages: the menu button (with the page's name beside it), the brand in the
 * middle, search and full screen on the right (`extra` — more round buttons before them). It fades with the
 * page's `--sheet` as the page scrolls. Focus keys: `home:menu` (the banner's Up goes there), `<id>:search`.
 */
export function HomeChrome({ id, label, extra, hideSearch }: { id: string; label?: string; extra?: ReactNode; hideSearch?: boolean }) {
  const navigate = useApp((s) => s.navigate);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const back = useApp((s) => s.back);
  const canBack = useApp((s) => s.history.length > 0);
  return (
    <div className="home__chrome">
      <div className="home__chrome-left">
        <Focusable
          as="button"
          className="home-round"
          focusKey="home:menu"
          scroll={false}
          onFocus={() => {
            // A glide still following the last card would pull the page back down.
            cancelGlides();
            document.querySelector(".app-body")?.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onPress={toggleSidebar}
        >
          <svg className="menu-icon" width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
              <path d="M5 5h14" />
              <path d="M5 12h14" />
              <path d="M5 19h14" />
            </g>
          </svg>
        </Focusable>
        {canBack && (
          <Focusable as="button" className="home-round" focusKey={`${id}:back`} scroll={false} back aria-label="Назад" onPress={() => back()}>
            <BackIcon size={24} strokeWidth={2.2} />
          </Focusable>
        )}
        {label && <span className="home__section">{label}</span>}
      </div>
      <div className="topbar__logo home__brand" aria-hidden="true">
        <img className="topbar__logo-mark" src={logoMark} alt="" />
        <span>
          KINON<em>YX</em>
        </span>
      </div>
      <div className="home__chrome-right">
        {extra}
        <NoticeBell focusKey={`${id}:bell`} />
        {!hideSearch && (
          <Focusable as="button" className="home-round" focusKey={`${id}:search`} scroll={false} onPress={() => navigate({ name: "search" })}>
            <SearchLensIcon />
          </Focusable>
        )}
        <FullscreenButton focusKey={`${id}:fullscreen`} className="home-round" />
      </div>
    </div>
  );
}
