import { Focusable } from "@kinonyx/ui";
import { FullscreenCornersIcon } from "./AnimatedIcons";
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
      <FullscreenCornersIcon exit={fullscreen} />
    </Focusable>
  );
}
