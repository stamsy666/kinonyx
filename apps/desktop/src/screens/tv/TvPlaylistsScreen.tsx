import { useState } from "react";
import { Focusable, FocusGroup, FolderIcon, GearIcon, PlusIcon, TrashIcon } from "@kinonyx/ui";
import { useApp } from "../../store/app";
import { useTv, type SavedPlaylist } from "../../store/tv";
import { TextField } from "../../components/TextField";
import { FullscreenButton } from "../../components/FullscreenButton";
import { FocusHighlight } from "../../components/FocusHighlight";
import logo from "../../assets/logo-mark.png";

function describe(p: SavedPlaylist, active: boolean, status: string) {
  if (active && status === "loading") return "Загружается…";
  if (p.lastError) return `Ошибка: ${p.lastError}`;
  const where = p.source.kind === "url" ? p.source.url : p.source.path;
  const count = p.channelCount ? `${p.channelCount} кан. · ` : "";
  return `${count}${where}`;
}

/** PortoTV's playlist entry screen: link field + "choose on device" + saved playlists. */
export function TvPlaylistsScreen() {
  const [url, setUrl] = useState("");
  const playlists = useTv((s) => s.playlists);
  const activeId = useTv((s) => s.activePlaylistId);
  const status = useTv((s) => s.playlistStatus);
  const addFromUrl = useTv((s) => s.addPlaylistFromUrl);
  const addFromFile = useTv((s) => s.addPlaylistFromFile);
  const openPlaylist = useTv((s) => s.openPlaylist);
  const removePlaylist = useTv((s) => s.removePlaylist);
  const navigate = useApp((s) => s.navigate);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const [fileError, setFileError] = useState<string | null>(null);

  const submit = () => {
    if (!url.trim()) return;
    void addFromUrl(url);
    setUrl("");
  };

  return (
    <FocusGroup focusKey="screen:playlists" className="screen screen--center">
      <div className="screen--center__header">
        {/* Not in PortoTV (a standalone app) — here it's the way back to the other sections. */}
        <Focusable as="button" className="icon-btn" focusKey="hdr:menu" onPress={toggleSidebar} scroll={false}>
          <span className="burger">
            <i />
            <i />
            <i />
          </span>
        </Focusable>
        <span style={{ flex: 1 }} />
        <FullscreenButton />
        <Focusable as="button" className="icon-btn" focusKey="hdr:settings" onPress={() => navigate({ name: "settings" })} scroll={false}>
          <GearIcon />
        </Focusable>
      </div>
      <div className="screen__body">
        <div className="screen__logo">
          <img src={logo} alt="KINONYX" />
        </div>
        <h1 className="screen__title screen__title--center">Введите ссылку на плейлист</h1>
        <div className="row">
          <TextField
            focusKey="pl:url"
            autoFocus={playlists.length === 0}
            type="url"
            value={url}
            onChange={setUrl}
            onSubmit={submit}
            placeholder="https://provider.tv/playlist.m3u"
            className="field--grow"
            icon={<PlusIcon />}
          />
          <Focusable as="button" className="btn btn--primary" focusKey="pl:add" onPress={submit} scroll={false}>
            <PlusIcon /> Добавить
          </Focusable>
        </div>

        <div style={{ height: 16 }} />

        <Focusable
          as="button"
          className="btn btn--wide"
          focusKey="pl:file"
          onPress={() => {
            setFileError(null);
            addFromFile().catch((e) => setFileError(e instanceof Error ? e.message : String(e)));
          }}
        >
          <FolderIcon /> Выбрать на устройстве
        </Focusable>
        {fileError && <div className="empty" style={{ padding: "10px 0 0" }}>{fileError}</div>}

        <div className="section-label">Плейлисты</div>
        {playlists.length === 0 ? (
          <div className="empty">Пока пусто — вставьте ссылку на M3U или выберите файл.</div>
        ) : (
          <div className="stack stagger">
            <FocusHighlight pad={8} />
            {playlists.map((p, i) => {
              const isActive = p.id === activeId;
              const dot = isActive && status === "loading" ? "loading" : p.lastError ? "error" : p.lastLoadedAt ? "ok" : "";
              return (
                <div className="row" key={p.id}>
                  <Focusable
                    className="tile playlist-row"
                    focusKey={`pl:${p.id}`}
                    autoFocus={i === 0 && playlists.length > 0}
                    style={{ flex: 1 }}
                    onPress={() => void openPlaylist(p.id)}
                  >
                    <span className="playlist-row__index">{i + 1}.</span>
                    <span className={`status-dot ${dot ? `status-dot--${dot}` : ""}`} />
                    <div className="playlist-row__main">
                      <div className="playlist-row__name">{p.name}</div>
                      <div className="playlist-row__meta">{describe(p, isActive, status)}</div>
                    </div>
                  </Focusable>
                  <Focusable as="button" className="icon-btn" focusKey={`pl:rm:${p.id}`} onPress={() => removePlaylist(p.id)} scroll={false}>
                    <TrashIcon />
                  </Focusable>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </FocusGroup>
  );
}
