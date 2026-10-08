import { useEffect, useLayoutEffect, useRef } from "react";
import {
  CategoriesIcon,
  CartoonsIcon,
  ChannelsIcon,
  FavoriteIcon,
  Focusable,
  FocusGroup,
  GearIcon,
  HomeIcon,
  MoviesIcon,
  SeriesIcon,
  onBack,
} from "@kinonyx/ui";
import { useApp, type Screen } from "../store/app";
import logoMark from "../assets/logo-mark.png";

interface Item {
  label: string;
  icon: typeof HomeIcon;
  /** Which section this item stands for — see `sectionOf`. */
  section: string;
  screen?: Screen;
  soon?: boolean;
}

const ITEMS: Item[] = [
  { label: "Главная", icon: HomeIcon, section: "home", screen: { name: "home" } },
  { label: "Фильмы", icon: MoviesIcon, section: "films", screen: { name: "catalog", kind: "films" } },
  { label: "Сериалы", icon: SeriesIcon, section: "series", screen: { name: "catalog", kind: "series" } },
  { label: "Мультфильмы", icon: CartoonsIcon, section: "cartoons", screen: { name: "catalog", kind: "cartoons" } },
  { label: "Категории", icon: CategoriesIcon, section: "categories", screen: { name: "categories-hub" } },
  { label: "Избранное", icon: FavoriteIcon, section: "favorites", screen: { name: "favorites" } },
  { label: "Каналы", icon: ChannelsIcon, section: "tv", screen: { name: "tv" } },
  { label: "Настройки", icon: GearIcon, section: "settings", screen: { name: "settings" } },
];

/** Top-level section a screen belongs to. Each item lights up only for its own section —
 *  "Главная" and "Фильмы" both lit up when both pointed at the home screen. */
function sectionOf(s: Screen): string | undefined {
  switch (s.name) {
    case "home":
      return "home";
    case "catalog":
    case "genre":
      return s.kind;
    case "categories-hub":
      return "categories";
    case "favorites":
      return "favorites";
    case "settings":
      return "settings";
    case "tv":
    case "tv-categories":
    case "tv-channels":
      return "tv";
    default:
      return undefined;
  }
}

export function Sidebar() {
  const open = useApp((s) => s.sidebarOpen);
  const close = useApp((s) => s.closeSidebar);
  const navigate = useApp((s) => s.navigate);
  const current = useApp((s) => sectionOf(s.screen));

  useEffect(() => {
    if (!open) return;
    return onBack(() => {
      close();
      return true;
    });
  }, [open, close]);

  // Closing animation: the menu is simply not rendered when closed, so when `open` turns off a
  // non-interactive copy of it (the nodes captured while it was open) is left in <body> and
  // slides/fades out (`.sidebar-ghost`, theme.css) before removing itself. Same trick as
  // components/Modal.tsx.
  const backdropRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const backdrop = backdropRef.current;
    const panel = backdrop?.nextElementSibling;
    const openedAt = performance.now();
    return () => {
      if (!backdrop || !panel || performance.now() - openedAt < 250) return; // StrictMode probe
      const ghosts = [backdrop, panel].map((node) => {
        const copy = node.cloneNode(true) as HTMLElement;
        copy.classList.add("sidebar-ghost");
        return copy;
      });
      document.body.append(...ghosts);
      window.setTimeout(() => ghosts.forEach((g) => g.remove()), 260);
    };
  }, [open]);

  if (!open) return null;

  const activeIndex = Math.max(0, ITEMS.findIndex((i) => i.section === current));

  return (
    <>
      <div ref={backdropRef} className="sidebar-backdrop" onClick={close} />
      <FocusGroup focusKey="sidebar" className="sidebar" isFocusBoundary preferredChildFocusKey={`sidebar:${activeIndex}`}>
        <div className="sidebar__brand">
          <div className="sidebar__brand-mark">
            <img src={logoMark} alt="" />
          </div>
          <div className="sidebar__brand-name">
            KINON<em>YX</em>
          </div>
        </div>
        <nav className="sidebar__nav">
          {ITEMS.map((item, i) => {
            const Icon = item.icon;
            return (
              <Focusable
                key={item.label}
                as="button"
                focusKey={`sidebar:${i}`}
                className={`sidebar__item ${item.section === current ? "is-active" : ""}`}
                scroll={false}
                soundGroup="menu"
                autoFocus={i === activeIndex}
                onPress={() => {
                  if (!item.screen) return close();
                  if (item.section === current) return close();
                  navigate(item.screen);
                }}
              >
                <Icon size={20} />
                <span className="sidebar__item-label">{item.label}</span>
                {item.soon && <span className="sidebar__item-hint">скоро</span>}
              </Focusable>
            );
          })}
        </nav>
      </FocusGroup>
    </>
  );
}
