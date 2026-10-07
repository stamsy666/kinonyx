import { useEffect, useRef } from "react";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { BackIcon, Focusable, FocusGroup, onBack } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { FullscreenButton } from "../components/FullscreenButton";

// Kinopoisk's widget player sends X-Frame-Options/frame-ancestors headers that block
// it from ever loading inside an <iframe> — that's enforced by the browser engine
// reading the FRAMED page's own headers, nothing on our side can bypass it. A real,
// separate Tauri window doesn't frame anything (it's a top-level navigation), so it
// isn't subject to that restriction. We size/position it to cover the main window
// below a thin bar that hosts our own back button, so it still reads as "fullscreen
// trailer inside the app" rather than a window that visibly belongs to a browser.
const LABEL = "kinonyx-trailer";
const BAR_HEIGHT = 64;

export function WebTrailerScreen({ title, url }: { title: string; url: string }) {
  const back = useApp((s) => s.back);
  const childRef = useRef<WebviewWindow | null>(null);
  const closingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let unlistenMoved: (() => void) | undefined;
    let unlistenResized: (() => void) | undefined;
    let unlistenDestroyed: (() => void) | undefined;

    async function geometry(main: ReturnType<typeof getCurrentWindow>) {
      const scale = await main.scaleFactor();
      const pos = (await main.innerPosition()).toLogical(scale);
      const size = (await main.innerSize()).toLogical(scale);
      return { x: pos.x, y: pos.y + BAR_HEIGHT, width: size.width, height: Math.max(size.height - BAR_HEIGHT, 100) };
    }

    async function open() {
      const main = getCurrentWindow();
      const g = await geometry(main);
      if (cancelled) return;

      const child = new WebviewWindow(LABEL, {
        url,
        parent: main,
        x: g.x,
        y: g.y,
        width: g.width,
        height: g.height,
        decorations: false,
        resizable: false,
        skipTaskbar: true,
        title,
      });
      childRef.current = child;

      child.once("tauri://error", (e) => console.warn("[web-trailer] failed to open window", e));
      unlistenDestroyed = await child.once("tauri://destroyed", () => {
        childRef.current = null;
        // Closed some other way than our own back button (e.g. Alt+F4) — leave the screen too.
        if (!closingRef.current) back();
      });

      const reposition = async () => {
        const c = childRef.current;
        if (!c) return;
        const next = await geometry(main);
        void c.setPosition(new LogicalPosition(next.x, next.y));
        void c.setSize(new LogicalSize(next.width, next.height));
      };
      unlistenMoved = await main.onMoved(reposition);
      unlistenResized = await main.onResized(reposition);
    }
    void open();

    return () => {
      cancelled = true;
      unlistenMoved?.();
      unlistenResized?.();
      unlistenDestroyed?.();
      closingRef.current = true;
      void childRef.current?.close();
      childRef.current = null;
    };
  }, [url, title, back]);

  useEffect(() => onBack(() => (back(), true)), [back]);

  return (
    <FocusGroup focusKey="web-trailer" className="web-trailer" isFocusBoundary>
      <div className="web-trailer__bar">
        <Focusable as="button" className="icon-btn web-trailer__back" focusKey="web-trailer:back" onPress={() => back()} autoFocus scroll={false}>
          <BackIcon />
        </Focusable>
        <span className="web-trailer__title">{title}</span>
        <FullscreenButton focusKey="web-trailer:fullscreen" className="icon-btn web-trailer__fullscreen" />
      </div>
    </FocusGroup>
  );
}
