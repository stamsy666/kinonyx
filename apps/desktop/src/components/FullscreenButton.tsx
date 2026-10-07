import { Focusable, ExitFullscreenIcon, FullscreenIcon } from "@kinonyx/ui";
import { useApp } from "../store/app";

export function FullscreenButton({ focusKey = "hdr:fullscreen", className = "icon-btn" }: { focusKey?: string; className?: string }) {
  const fullscreen = useApp((s) => s.fullscreen);
  const toggleFullscreen = useApp((s) => s.toggleFullscreen);
  return (
    <Focusable
      as="button"
      className={className}
      focusKey={focusKey}
      onPress={() => void toggleFullscreen()}
      scroll={false}
    >
      {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
    </Focusable>
  );
}
