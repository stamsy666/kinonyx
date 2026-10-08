import { isTauri } from "./io";

/**
 * Whole-program zoom. In the app it is the webview's own zoom (what Ctrl+plus does in a browser):
 * layout, mouse coordinates and spatial navigation all stay consistent. In the browser preview
 * there is no webview, so the CSS `zoom` of the page stands in.
 */
export async function applyUiZoom(zoom: number) {
  if (isTauri) {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(zoom);
    } catch {
      /* no zoom permission / older runtime: the program stays at its normal size */
    }
    return;
  }
  document.documentElement.style.zoom = zoom === 1 ? "" : String(zoom);
}
