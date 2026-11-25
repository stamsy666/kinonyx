import { useEffect, useState } from "react";
import { ArchiveIcon, BellIcon, DownloadIcon, EpisodesIcon, Focusable } from "@kinonyx/ui";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { useApp } from "../store/app";
import { unreadCount, useNotices, type Notice, type NoticeKind } from "../store/notifications";
import { Modal } from "./Modal";
import { img } from "../data/images";

/** "только что", "5 мин назад", "2 ч назад", "вчера", "3 дня назад", then the date. */
export function ago(at: number, now = Date.now()): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d === 1) return "вчера";
  if (d < 7) return `${d} дн. назад`;
  return new Date(at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

const previewNotices: Notice[] = import.meta.env.DEV ? [
  { id: "preview:episode", kind: "episode", title: "Новая серия", text: "Тестовое уведомление о выходе серии", at: Date.now(), read: true },
  { id: "preview:download", kind: "download", title: "Загрузка завершена", text: "Тестовое уведомление о готовой загрузке", at: Date.now() - 300_000, read: true },
] : [];

/** The bell in the header: the number of what is unread and the list of what happened (a new episode, a finished download, an update). */
export function NoticeBell({ focusKey }: { focusKey: string }) {
  const items = useNotices((s) => s.items);
  const [open, setOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(import.meta.env.DEV);
  const unread = unreadCount(items);
  return (
    <>
      <Focusable as="button" className="home-round home-round--bell" focusKey={focusKey} scroll={false} aria-label="Уведомления" onPress={() => setOpen(true)}>
        <BellIcon size={22} />
        {unread > 0 && <i className="home-round__dot">{unread > 9 ? "9+" : unread}</i>}
      </Focusable>
      {open && (
        <NoticesModal
          showPreview={showPreview}
          onClear={() => {
            setShowPreview(false);
            useNotices.getState().clear();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const KIND_ICON: Record<NoticeKind, typeof BellIcon> = {
  episode: EpisodesIcon,
  download: DownloadIcon,
  update: ArchiveIcon,
  info: BellIcon,
};

function NoticesModal({ showPreview, onClear, onClose }: { showPreview: boolean; onClear: () => void; onClose: () => void }) {
  const notices = useNotices((s) => s.items);
  const items = showPreview ? [...previewNotices, ...notices] : notices;
  const navigate = useApp((s) => s.navigate);
  const initialFocus = items.length > 0 ? "notice:0" : "notice:close";
  // What was new when the window opened stays marked for as long as it is open.
  const [fresh] = useState(() => new Set(useNotices.getState().items.filter((n) => !n.read).map((n) => n.id)));
  useEffect(() => {
    useNotices.getState().markAllRead();
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFocus(initialFocus));
    return () => cancelAnimationFrame(frame);
  }, [initialFocus]);
  const freshCount = items.filter((notice) => fresh.has(notice.id)).length;

  const go = (n: Notice) => {
    onClose();
    if (n.filmId !== undefined) navigate({ name: "movie", id: n.filmId, preview: { kinopoiskId: n.filmId, nameRu: n.title, posterUrlPreview: n.poster } });
    else if (n.goto === "downloads") navigate({ name: "downloads" });
    else if (n.goto === "settings") navigate({ name: "settings" });
  };

  return (
    <Modal focusKey="notices" preferredChildFocusKey={initialFocus} className="kx-notice" onClose={onClose}>
      <header className="kx-notice__head">
        <h3 className="kx-notice__title">Уведомления</h3>
        {freshCount > 0 && <span className="kx-notice__count">{freshCount > 9 ? "9+" : freshCount}</span>}
      </header>
      <div className="kx-notice__body">
        {items.length === 0 && <p className="kx-notice__empty">Пока здесь ничего нового</p>}
        {items.map((n, i) => {
          const Icon = KIND_ICON[n.kind] ?? BellIcon;
          return (
            <Focusable as="button" key={n.id} focusKey={`notice:${i}`} className={`kx-notice-row ${fresh.has(n.id) ? "kx-notice-row--new" : ""}`} scrollBlock="nearest" onPress={() => go(n)}>
              {n.poster ? <img className="kx-notice-row__poster" src={img(n.poster)} alt="" /> : <span className="kx-notice-row__icon"><Icon /></span>}
              <span className="kx-notice-row__body">
                <span className="kx-notice-row__title">{n.title}</span>
                {n.text && <span className="kx-notice-row__text">{n.text}</span>}
              </span>
              <span className="kx-notice-row__when">{ago(n.at)}</span>
            </Focusable>
          );
        })}
      </div>
      <footer className="kx-notice__foot">
        {items.length > 0 && (
          <Focusable as="button" className="kx-notice-btn" focusKey="notice:clear" scroll={false} onPress={onClear}>
            Очистить список
          </Focusable>
        )}
        <Focusable as="button" back className="kx-notice-btn" focusKey="notice:close" scroll={false} onPress={onClose}>
          Закрыть
        </Focusable>
      </footer>
    </Modal>
  );
}
