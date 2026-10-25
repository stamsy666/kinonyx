import { Focusable } from "@kinonyx/ui";
import { useUpdater } from "../store/updater";
import { Modal } from "./Modal";

/** "Доступна новая версия" — shown over any non-player screen once a check finds one. In the look of the other
 *  windows (the film page's "Трейлеры"): a centred title, pill rows, the main one white. */
export function UpdateModal() {
  const status = useUpdater((s) => s.status);
  const update = useUpdater((s) => s.update);
  const progress = useUpdater((s) => s.progress);
  const error = useUpdater((s) => s.error);
  const install = useUpdater((s) => s.install);
  const dismiss = useUpdater((s) => s.dismiss);

  const busy = status === "downloading" || status === "installing";

  return (
    <Modal focusKey="update-modal" preferredChildFocusKey="update:install" className="links-tv update-tv" onClose={() => !busy && dismiss()}>
      <h3 className="links-tv__title">Доступна версия {update?.version}</h3>
      {update?.body && !busy && (
        <div className="update-tv__notes links-tv__scroll">
          <p>{update.body}</p>
        </div>
      )}
      {busy && (
        <div className="update-tv__progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      <p className="links-tv__text update-tv__status">
        {status === "downloading" && `Загрузка… ${Math.round(progress * 100)}%`}
        {status === "installing" && "Устанавливаю — программа перезапустится сама."}
        {status === "error" && error}
        {status === "available" && "Обновление скачается и установится автоматически."}
      </p>
      <div className="links-tv__list">
        <Focusable
          as="button"
          className="links-tv__row links-tv__row--primary"
          focusKey="update:install"
          autoFocus
          scroll={false}
          onPress={() => !busy && void install()}
        >
          <span className="links-tv__name">{busy ? "Обновляю…" : status === "error" ? "Повторить" : "Обновить"}</span>
        </Focusable>
        {!busy && (
          <Focusable as="button" back className="links-tv__row links-tv__row--close" focusKey="update:later" scroll={false} onPress={dismiss}>
            <span className="links-tv__name">Позже</span>
          </Focusable>
        )}
      </div>
    </Modal>
  );
}
