import { useEffect, useRef, useState } from "react";
import { Focusable } from "@kinonyx/ui";
import { isTauri } from "../data/io";

interface Props {
  focusKey: string;
  /** Click / Enter / remote OK — open the system file dialog. */
  onPick: () => void;
  /** A file dropped onto the window (desktop app only: the webview hands us real paths). */
  onDropPaths: (paths: string[]) => void;
  /** Shown under the title, e.g. the accepted formats. */
  hint: string;
  /** Extensions (lower-case, no dot) accepted from a drop; others are ignored. */
  extensions: string[];
}

/**
 * "Animated file upload": a dashed drop zone whose border, icon and caption react while a
 * file is dragged over the window — the zone grows a touch, the border takes the accent
 * colour, the arrow floats up and the caption swaps to "Отпустите файл". It is also an
 * ordinary focusable button, so the remote / keyboard / gamepad can open the file dialog.
 *
 * In the desktop app drag-and-drop comes through Tauri's webview event (the browser's own
 * drop event carries no file path there); in the browser preview the animation still plays,
 * but a dropped file can't be used (no path), so it says so.
 */
export function FileDropZone({ focusKey, onPick, onDropPaths, hint, extensions }: Props) {
  const [over, setOver] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const handler = useRef(onDropPaths);
  handler.current = onDropPaths;

  const accepts = (path: string) => extensions.includes((path.split(".").pop() ?? "").toLowerCase());

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          const p = event.payload;
          if (p.type === "enter" || p.type === "over") setOver(true);
          else if (p.type === "leave") setOver(false);
          else if (p.type === "drop") {
            setOver(false);
            const good = p.paths.filter(accepts);
            if (!good.length) setNote(`Нужен файл плейлиста: ${extensions.map((e) => `.${e}`).join(", ")}`);
            else {
              setNote(null);
              handler.current(good);
            }
          }
        }),
      )
      .then((un) => {
        if (cancelled) un();
        else unlisten = un;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browser preview: HTML5 drag events, animation only.
  const browserDrag = isTauri
    ? {}
    : {
        onDragEnter: (e: React.DragEvent) => {
          e.preventDefault();
          setOver(true);
        },
        onDragOver: (e: React.DragEvent) => e.preventDefault(),
        onDragLeave: () => setOver(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setOver(false);
          setNote("Перетаскивание файлов работает в приложении (в браузерном превью нет пути к файлу)");
        },
      };

  return (
    <>
      {/* Focusable doesn't forward DOM drag handlers, so the browser-preview ones sit on a wrapper. */}
      <div className="dropzone-wrap" {...browserDrag}>
      <Focusable
        as="button"
        className={`dropzone ${over ? "is-over" : ""}`}
        focusKey={focusKey}
        onPress={() => {
          setNote(null);
          onPick();
        }}
      >
        <svg className="dropzone__icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <span className="dropzone__title">
          <span className={`dropzone__line ${over ? "" : "is-shown"}`}>Перетащите файл плейлиста или нажмите, чтобы выбрать</span>
          <span className={`dropzone__line ${over ? "is-shown" : ""}`}>Отпустите файл здесь</span>
        </span>
        <span className="dropzone__hint">{hint}</span>
      </Focusable>
      </div>
      {note && <div className="empty" style={{ padding: "10px 0 0" }}>{note}</div>}
    </>
  );
}
