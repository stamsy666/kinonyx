import { DownloadIcon, Focusable, FocusGroup } from "@kinonyx/ui";
import { HomeChrome } from "../components/HomeChrome";
import { useApp } from "../store/app";
import { pauseTransfer, removeDownload, startTransfer, useDownloads, type DownloadItem } from "../store/downloads";
import { img } from "../data/images";
import { isTauri } from "../data/io";

function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} ГБ`;
  return `${Math.round(n / 1024 ** 2)} МБ`;
}

function statusLine(d: DownloadItem): string {
  const pct = d.total > 0 ? Math.floor((d.received / d.total) * 100) : 0;
  switch (d.status) {
    case "preparing":
      return "Подключаюсь к раздаче…";
    case "downloading": {
      const left = d.speed > 0 && d.total > d.received ? Math.ceil((d.total - d.received) / d.speed) : 0;
      const eta = left > 0 ? ` · осталось ${left >= 3600 ? `${Math.floor(left / 3600)} ч ${Math.floor((left % 3600) / 60)} мин` : `${Math.max(1, Math.ceil(left / 60))} мин`}` : "";
      return `${pct}% · ${bytes(d.received)} из ${bytes(d.total)}${d.speed > 0 ? ` · ${(d.speed / 1024 ** 2).toFixed(1)} МБ/с` : ""}${eta}`;
    }
    case "paused":
      return `Пауза · ${pct}% (${bytes(d.received)} из ${d.total ? bytes(d.total) : "?"})`;
    case "error":
      return d.error ?? "Ошибка";
    case "done":
      return `Готово · ${bytes(d.total || d.received)}`;
  }
}

async function reveal(path: string) {
  if (!isTauri) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

export function DownloadsScreen() {
  const navigate = useApp((s) => s.navigate);
  const items = useDownloads((s) => s.items);

  const play = (d: DownloadItem) =>
    d.path &&
    navigate({
      name: "player",
      title: d.title,
      url: d.path,
      filmId: d.filmId,
      film: d.film,
      poster: d.poster,
    });

  return (
    <FocusGroup focusKey="downloads" className="screen-pad home home--tv home--nohero dl-screen">
      <HomeChrome id="downloads" label="Загрузки" hideSearch />
      <div className="dl">
        {items.length === 0 && (
          <div className="dl__empty">
            <DownloadIcon size={64} strokeWidth={1.2} />
            <p>Здесь будут фильмы, сохранённые на диск. Кнопка «Скачать» — на странице фильма.</p>
          </div>
        )}
        {items.map((d, n) => {
          const pct = d.total > 0 ? Math.min(100, (d.received / d.total) * 100) : 0;
          const running = d.status === "downloading" || d.status === "preparing";
          return (
            <section className={`dl__item dl__item--${d.status}`} key={d.id}>
              {d.poster && <img className="dl__poster" src={d.poster.startsWith("http") ? img(d.poster) : d.poster} alt="" />}
              <div className="dl__body">
                <div className="dl__title">{d.title}</div>
                <div className="dl__status">{statusLine(d)}</div>
                {d.status !== "done" && (
                  <div className="dl__bar">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                )}
                <div className="dl__actions">
                  {d.status === "done" && d.path && (
                    <>
                      <Focusable as="button" className="dl__btn dl__btn--primary" focusKey={`dl:${n}:play`} autoFocus={n === 0} onPress={() => play(d)}>
                        Смотреть
                      </Focusable>
                      <Focusable as="button" className="dl__btn" focusKey={`dl:${n}:open`} onPress={() => void reveal(d.path!)}>
                        Показать в папке
                      </Focusable>
                    </>
                  )}
                  {running && (
                    <Focusable as="button" className="dl__btn dl__btn--primary" focusKey={`dl:${n}:pause`} autoFocus={n === 0} onPress={() => void pauseTransfer(d.id)}>
                      Пауза
                    </Focusable>
                  )}
                  {(d.status === "paused" || d.status === "error") && (
                    <Focusable as="button" className="dl__btn dl__btn--primary" focusKey={`dl:${n}:resume`} autoFocus={n === 0} onPress={() => void startTransfer(d.id)}>
                      Продолжить
                    </Focusable>
                  )}
                  <Focusable as="button" className="dl__btn" focusKey={`dl:${n}:remove`} onPress={() => void removeDownload(d.id, false)}>
                    {d.status === "done" ? "Убрать из списка" : "Отменить"}
                  </Focusable>
                  {d.status === "done" && (
                    <Focusable as="button" className="dl__btn" focusKey={`dl:${n}:delete`} onPress={() => void removeDownload(d.id, true)}>
                      Удалить файл
                    </Focusable>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </FocusGroup>
  );
}
