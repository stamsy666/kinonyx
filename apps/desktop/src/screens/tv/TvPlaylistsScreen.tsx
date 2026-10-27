import { useState } from "react";
import { ChannelsIcon, Focusable, FocusGroup, NextIcon, PlusIcon, TrashIcon } from "@kinonyx/ui";
import { FileDropZone } from "../../components/FileDropZone";
import { HomeChrome } from "../../components/HomeChrome";
import { EmptyState } from "../../components/EmptyState";
import { useTv, type SavedPlaylist } from "../../store/tv";
import { TextField } from "../../components/TextField";

function describe(p: SavedPlaylist, active: boolean, status: string) {
  if (active && status === "loading") return "Загружается…";
  if (p.lastError) return `Ошибка: ${p.lastError}`;
  const where = p.source.kind === "url" ? p.source.url : p.source.path;
  const count = p.channelCount ? `${p.channelCount} кан. · ` : "";
  return `${count}${where}`;
}

/** The playlist entry screen in the settings look: a picture and a few words on the left; on the right the link
 *  field, "choose a file" and the saved playlists, every one a pill row. */
export function TvPlaylistsScreen() {
  const [url, setUrl] = useState("");
  const playlists = useTv((s) => s.playlists);
  const activeId = useTv((s) => s.activePlaylistId);
  const status = useTv((s) => s.playlistStatus);
  const addFromUrl = useTv((s) => s.addPlaylistFromUrl);
  const addFromFile = useTv((s) => s.addPlaylistFromFile);
  const openPlaylist = useTv((s) => s.openPlaylist);
  const removePlaylist = useTv((s) => s.removePlaylist);
  const [fileError, setFileError] = useState<string | null>(null);

  const submit = () => {
    if (!url.trim()) return;
    void addFromUrl(url);
    setUrl("");
  };

  return (
    <FocusGroup focusKey="screen:playlists" className="screen-pad home home--tv home--nohero settings--tv">
      <HomeChrome id="tv" label="Каналы" hideSearch />

      <div className="stx">
        <div className="stx__stage">
          <div className="stx__art">
            <ChannelsIcon size={300} strokeWidth={1} />
          </div>
          <p className="stx__desc">Вставьте ссылку на плейлист или выберите файл — каналы и программа передач появятся здесь.</p>
        </div>

        <div className="stx__list">
          <div className="settings-pane">
            <section className="settings__item">
              <div className="settings__label">Новый плейлист</div>
              <TextField
                focusKey="pl:url"
                autoFocus={playlists.length === 0}
                type="url"
                value={url}
                onChange={setUrl}
                onSubmit={submit}
                placeholder="Ссылка на плейлист: https://provider.tv/playlist.m3u"
                className="field--grow"
              />
              <Focusable as="button" className="cycle-row" focusKey="pl:add" scroll={false} onPress={submit}>
                <PlusIcon size={20} />
                <span className="cycle-row__label">Добавить по ссылке</span>
                <NextIcon size={20} />
              </Focusable>
              <FileDropZone
                focusKey="pl:file"
                hint="M3U · M3U8 · TXT"
                extensions={["m3u", "m3u8", "txt"]}
                onPick={() => {
                  setFileError(null);
                  addFromFile().catch((e) => setFileError(e instanceof Error ? e.message : String(e)));
                }}
                onDropPaths={(paths) => {
                  setFileError(null);
                  addFromFile(paths[0]).catch((e) => setFileError(e instanceof Error ? e.message : String(e)));
                }}
              />
              {fileError && <div className="settings__hint settings__hint--error">{fileError}</div>}
            </section>

            <section className="settings__item">
              <div className="settings__label">Мои плейлисты</div>
              {playlists.length === 0 ? (
                <EmptyState compact icon={<ChannelsIcon size={34} strokeWidth={1.6} />} title="Плейлистов пока нет" hint="Вставьте ссылку выше или перетащите файл, и каналы появятся здесь." />
              ) : (
                playlists.map((p, i) => {
                  const isActive = p.id === activeId;
                  const dot = isActive && status === "loading" ? "loading" : p.lastError ? "error" : p.lastLoadedAt ? "ok" : "";
                  return (
                    <div className="pl-item" key={p.id}>
                      <Focusable
                        as="button"
                        className="cycle-row pl-item__main"
                        focusKey={`pl:${p.id}`}
                        autoFocus={i === 0}
                        onPress={() => void openPlaylist(p.id)}
                      >
                        <i className={`pl-dot ${dot ? `pl-dot--${dot}` : ""}`} aria-hidden />
                        <span className="pl-item__name">{p.name}</span>
                        <span className="pl-item__meta">{describe(p, isActive, status)}</span>
                        <NextIcon size={20} />
                      </Focusable>
                      <Focusable as="button" className="tr-item__action" focusKey={`pl:rm:${p.id}`} scroll={false} onPress={() => removePlaylist(p.id)}>
                        <TrashIcon />
                      </Focusable>
                    </div>
                  );
                })
              )}
            </section>
          </div>
        </div>
      </div>
    </FocusGroup>
  );
}
