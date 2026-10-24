import { useFocusable, type UseFocusableConfig } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect, useRef, type ReactNode, type CSSProperties } from "react";
import { cancelGlides, glideIntoView } from "./glide";
import { emitBackSound, emitMoveSound, emitPressSound, type NavSoundGroup } from "./soundBus";

/**
 * When the viewer's hand last really moved the mouse (or turned the wheel, or pressed). A mouse that lies still
 * over a spot where something new appears (results arriving while a letter is typed, a row being rebuilt) makes
 * the browser report "entered" for it all the same — and the focus must not jump there then.
 */
let lastRealPointer = 0;
if (typeof window !== "undefined") {
  const touch = () => {
    lastRealPointer = performance.now();
  };
  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.movementX !== 0 || e.movementY !== 0 || e.pointerType !== "mouse") touch();
    },
    { passive: true, capture: true },
  );
  window.addEventListener("wheel", touch, { passive: true, capture: true });
  window.addEventListener("pointerdown", touch, { passive: true, capture: true });
}
/** A "mouse entered" this long after the last real movement is not the viewer's doing. */
const HOVER_WINDOW_MS = 160;

interface FocusableProps extends Omit<UseFocusableConfig, "extraProps"> {
  className?: string;
  style?: CSSProperties;
  as?: "div" | "button";
  children: ReactNode | ((focused: boolean) => ReactNode);
  onPress?: () => void;
  /** Move focus here on mouse hover so mouse and remote share one highlight. */
  hoverFocus?: boolean;
  /** Scroll into view when focused (default true). */
  scroll?: boolean;
  scrollBlock?: ScrollLogicalPosition;
  autoFocus?: boolean;
  /** Tags remote/keyboard focus-move sound as belonging to a distinct group
   *  (e.g. the sidebar menu) instead of the app's generic navigation sound. */
  soundGroup?: NavSoundGroup;
  /** Suppresses the generic navigation/press sounds entirely — for controls that
   *  play their own bespoke sound instead (e.g. the sound picker itself). */
  mute?: boolean;
  /** A back/close control: plays the "back" sound instead of the press sound. */
  back?: boolean;
}

export function Focusable({
  className = "",
  style,
  as = "div",
  children,
  onPress,
  hoverFocus = true,
  scroll = true,
  scrollBlock = "center",
  autoFocus,
  soundGroup,
  mute,
  back,
  onEnterPress,
  onFocus,
  ...config
}: FocusableProps) {
  // A click on a not-yet-focused element (fast mouse movement/scroll landing on it without
  // a prior hover, a modal opening under the cursor, ...) makes `focusSelf` below fire
  // `onFocus` right before the click's own press sound — two sounds for one press. Set
  // right before that `focusSelf` call and consumed by the `onFocus` it triggers (whenever
  // the scheduler actually gets to it), so only the click's own sound plays.
  const suppressNextMoveSound = useRef(false);

  const { ref, focused, focusSelf, focusKey } = useFocusable<HTMLElement>({
    ...config,
    onEnterPress: (props, details) => {
      onEnterPress?.(props, details);
      if (onPress && !mute) (back ? emitBackSound() : emitPressSound());
      onPress?.();
    },
    onFocus: (layout, props, details) => {
      onFocus?.(layout, props, details);
      const { byMouse, restore } = (details ?? {}) as { byMouse?: boolean; restore?: boolean };
      // `restore`: focus put back by the app itself (returning from a screen) — not a move
      // the viewer made, so no sound, and no smooth scroll animating in from the top.
      if (suppressNextMoveSound.current) {
        suppressNextMoveSound.current = false;
      } else if (!mute && !restore) {
        emitMoveSound(soundGroup, byMouse);
      }
      // Mouse hover only fires on elements already visible on screen — scrolling
      // to them just makes the page jump around as the cursor moves. Only
      // keyboard/gamepad navigation (which can land on off-screen items) scrolls;
      // both get the navigation sound.
      if (!byMouse && scroll) {
        const el = ref.current;
        if (restore && el) {
          // A restored focus keeps the page exactly where "Назад" put it. Even "nearest" nudged
          // the page (a card sticking out past the bottom edge scrolled up to show its whole
          // title: the home page came back ~65 px off) — so only scroll if the card is not on
          // screen at all.
          const r = el.getBoundingClientRect();
          const visible = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
          cancelGlides();
          if (!visible) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        } else {
          // Every focus move glides (one retargetable animation, see glide.ts) so holding an arrow keeps up.
          const track = el?.closest(".row-scroll__track") as HTMLElement | null;
          // Grids, tiles, keys and lists scroll the page the same way (instant to follow, never queued).
          if (el) glideIntoView(el, scrollBlock, track);
        }
      }
    },
  });

  useEffect(() => {
    if (autoFocus) focusSelf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  const Tag = as;
  return (
    <Tag
      ref={ref as never}
      data-fk={focusKey}
      className={`focusable ${focused ? "is-focused" : ""} ${className}`}
      style={style}
      onMouseEnter={
        hoverFocus
          ? () => {
              if (performance.now() - lastRealPointer > HOVER_WINDOW_MS) return;
              focusSelf({ byMouse: true });
            }
          : undefined
      }
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        if (!focused) suppressNextMoveSound.current = true;
        focusSelf({ byMouse: true });
        if (onPress && !mute) (back ? emitBackSound() : emitPressSound());
        onPress?.();
      }}
    >
      {typeof children === "function" ? children(focused) : children}
    </Tag>
  );
}
