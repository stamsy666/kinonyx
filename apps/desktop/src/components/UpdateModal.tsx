import { Focusable } from "@kinonyx/ui";
import { useUpdater } from "../store/updater";
import { Modal } from "./Modal";

/** "Доступна новая версия" — shown over any non-player screen once a check finds one. */
export function UpdateModal() {
  const status = useUpdater((s) => s.status);
  const update = useUpdater((s) => s.update);
  const progress = useUpdater((s) => s.progress);
  const error = useUpdater((s) => s.error);
  const install = useUpdater((s) => s.install);
  const dismiss = useUpdater((s) => s.dismiss);

  const busy = status === "downloading" || status === "installing";

  return (
    <Modal focusKey="update-modal" preferredChildFocusKey="update:install" onClose={() => !busy && dismiss()}>
      <div className="modal-panel__header">
        <h3>Доступна версия {update?.version}</h3>
      </div>
      {update?.body && <p className="update__notes">{update.body}</p>}
      {busy && (
        <div className="update__progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      <p className="update__status">
        {status === "downloading" && `Загрузка… ${Math.round(progress * 100)}%`}
        {status === "installing" && "Устанавливаю — программа перезапустится сама."}
        {status === "error" && error}
        {status === "available" && "Обновление скачается и установится автоматически."}
      </p>
      <div className="trailer-error__actions">
        <Focusable
          as="button"
          className="btn btn--primary"
          focusKey="update:install"
          autoFocus
          scroll={false}
          onPress={() => !busy && void install()}
        >
          {busy ? "Обновляю…" : status === "error" ? "Повторить" : "Обновить"}
        </Focusable>
        {!busy && (
          <Focusable as="button" className="btn" focusKey="update:later" scroll={false} onPress={dismiss}>
            Позже
          </Focusable>
        )}
      </div>
    </Modal>
  );
}
