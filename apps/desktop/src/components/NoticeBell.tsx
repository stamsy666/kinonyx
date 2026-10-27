import { useState } from "react";
import { BellIcon, Focusable } from "@kinonyx/ui";
import { useApp } from "../store/app";
import { unreadCount, useNotices, type Notice } from "../store/notifications";
import { EmptyState } from "./EmptyState";
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

/** The bell in the header: the number of what is unread and the list of what happened (a new episode, a finished download, an update). */
export function NoticeBell({ focusKey }: { focusKey: string }) {
  const items = useNotices((s) => s.items);
  const [open, setOpen] = useState(false);
  const unread = unreadCount(items);
  return (
    <>
      <Focusable as="button" className="home-round home-round--bell" focusKey={focusKey} scroll={false} aria-label="Уведомления" onPress={() => setOpen(true)}>
        <BellIcon size={22} />
        {unread > 0 && <i className="home-round__dot">{unread > 9 ? "9+" : unread}</i>}
      </Focusable>
      {open && <NoticesModal onClose={() => setOpen(false)} />}
    </>
  );
}

function NoticesModal({ onClose }: { onClose: () => void }) {
  const items = useNotices((s) => s.items);
  const navigate = useApp((s) => s.navigate);
  // What was new when the window opened stays marked for as long as it is open.
  const [fresh] = useState(() => new Set(useNotices.getState().items.filter((n) => !n.read).map((n) => n.id)));
  useState(() => {
    useNotices.getState().markAllRead();
  });

  const go = (n: Notice) => {
    onClose();
    if (n.filmId !== undefined) navigate({ name: "movie", id: n.filmId, preview: { kinopoiskId: n.filmId, nameRu: n.title, posterUrlPreview: n.poster } });
    else if (n.goto === "downloads") navigate({ name: "downloads" });
    else if (n.goto === "settings") navigate({ name: "settings" });
  };

  return (
    <Modal focusKey="notices" preferredChildFocusKey="notice:0" className="links-tv" onClose={onClose}>
      <h3 className="links-tv__title">Уведомления</h3>
      <div className="links-tv__list links-tv__scroll">
        {items.length === 0 && <EmptyState compact icon={<BellIcon size={34} strokeWidth={1.6} />} title="Пока ничего нового" hint="Здесь появятся новые серии избранных сериалов, готовые загрузки и обновления." />}
        {items.map((n, i) => (
          <Focusable as="button" key={n.id} focusKey={`notice:${i}`} className={`links-tv__row notice-row ${fresh.has(n.id) ? "notice-row--new" : ""}`} autoFocus={i === 0} scroll={false} onPress={() => go(n)}>
            {n.poster ? <img className="notice-row__poster" src={img(n.poster)} alt="" /> : <span className="notice-row__poster notice-row__poster--none" />}
            <span className="notice-row__body">
              <span className="notice-row__title">{n.title}</span>
              {n.text && <span className="notice-row__text">{n.text}</span>}
            </span>
            <span className="notice-row__when">{ago(n.at)}</span>
          </Focusable>
        ))}
      </div>
      {items.length > 0 && (
        <Focusable as="button" className="links-tv__row links-tv__row--center" focusKey="notice:clear" scroll={false} onPress={() => useNotices.getState().clear()}>
          <span className="links-tv__name">Очистить список</span>
        </Focusable>
      )}
      <Focusable as="button" back className="links-tv__row links-tv__row--close links-tv__foot" focusKey="notice:close" scroll={false} onPress={onClose}>
        <span className="links-tv__name">Закрыть</span>
      </Focusable>
    </Modal>
  );
}
