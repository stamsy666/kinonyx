import { isTauri } from "./io";

/**
 * What a 4K-class screen needs on top of the viewer's own choice. The interface is drawn for a Full HD screen
 * (1920×1080 at 100%). A 4K screen has Windows scale it up (a TV usually 200–300%): the page then has far fewer
 * CSS pixels than it was drawn for and everything comes out huge — or, at 100%, far too small. So on a screen of 1800+
 * pixels high the zoom is chosen so that the page is again about 1080 CSS pixels high, and "100%" in the settings
 * means "as on Full HD". Smaller screens are left exactly as they were.
 */
async function autoFactor(): Promise<number> {
  try {
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const m = await currentMonitor();
    if (!m || m.size.height < 1800) return 1;
    return Math.min(2.5, Math.max(0.5, m.size.height / m.scaleFactor / 1080));
  } catch {
    return 1;
  }
}

/**
 * Whole-program zoom. In the app it is the webview's own zoom (what Ctrl+plus does in a browser):
 * layout, mouse coordinates and spatial navigation all stay consistent. In the browser preview
 * there is no webview, so the CSS `zoom` of the page stands in.
 */
export async function applyUiZoom(zoom: number) {
  if (isTauri) {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(zoom * (await autoFactor()));
    } catch {
      /* no zoom permission / older runtime: the program stays at its normal size */
    }
    return;
  }
  document.documentElement.style.zoom = zoom === 1 ? "" : String(zoom);
}
