import type { ReactNode } from "react";
import { BackIcon, Focusable, GearIcon } from "@kinonyx/ui";
import { FullscreenButton } from "./FullscreenButton";

interface Props {
  eyebrow?: string;
  title: string;
  /** Small caption under the title (e.g. a summary line), not a navigable action. */
  subtitle?: ReactNode;
  /** The sidebar burger — only screens reachable directly from the sidebar (not just by
   *  drilling into something) get one, same as CategoriesHubScreen's own header. */
  onMenu?: () => void;
  onBack?: () => void;
  onSettings?: () => void;
  children?: ReactNode;
}

/** PortoTV's screen header, as-is: back + title on the left, fullscreen + settings right. */
export function TvScreenHeader({ eyebrow, title, subtitle, onMenu, onBack, onSettings, children }: Props) {
  return (
    <header className="screen__head">
      <div className="row" style={{ gap: 20 }}>
        {onMenu && (
          <Focusable as="button" className="icon-btn" focusKey="hdr:menu" onPress={onMenu} scroll={false}>
            <span className="burger">
              <i />
              <i />
              <i />
            </span>
          </Focusable>
        )}
        {onBack && (
          <Focusable as="button" className="icon-btn" focusKey="hdr:back" onPress={onBack} scroll={false}>
            <BackIcon />
          </Focusable>
        )}
        <div>
          {eyebrow && <p className="screen__eyebrow">{eyebrow}</p>}
          <h1 className="screen__title">{title}</h1>
          {subtitle && <p className="screen__subtitle">{subtitle}</p>}
        </div>
      </div>
      <div className="row">
        {children}
        <FullscreenButton />
        {onSettings && (
          <Focusable as="button" className="icon-btn" focusKey="hdr:settings" onPress={onSettings} scroll={false}>
            <GearIcon />
          </Focusable>
        )}
      </div>
    </header>
  );
}
