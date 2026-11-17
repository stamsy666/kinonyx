import { useEffect, useRef, useState } from "react";
// Положить kinonyx-intro.webm в src/assets/intro/ (Vite отдаст его как файл со своим хешем).
import introUrl from "../assets/intro/kinonyx-intro.webm";

/**
 * Заставка при запуске: 5,6 с, конец — на цвете фона приложения (#0a0708), так что
 * главный экран проявляется без скачка. Пропускается любой клавишей, кликом или кнопкой
 * геймпада/пульта (мост геймпада и пульт с телефона шлют обычные keydown).
 */
const KEY = "kinonyx.introOnStart";

export function introEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setIntroEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* профиль без localStorage — заставка просто будет включена */
  }
}

/** `volume` 0..1 — the interface sounds' volume (0 = silent intro). */
export function IntroSplash({ onDone, volume = 1 }: { onDone: () => void; volume?: number }) {
  const [leaving, setLeaving] = useState(false);
  const finished = useRef(false);
  const video = useRef<HTMLVideoElement>(null);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    setLeaving(true);
    window.setTimeout(onDone, 320);
  };

  useEffect(() => {
    const skip = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      finish();
    };
    // capture: клавиша не должна заодно сработать на экране под заставкой
    window.addEventListener("keydown", skip, true);
    window.addEventListener("pointerdown", skip, true);
    // если видео не стартовало (нет кодека, файл не найден) — не держать человека
    const guard = window.setTimeout(finish, 8000);

    const v = video.current;
    if (v) {
      v.volume = Math.min(1, Math.max(0, volume));
      v.muted = volume <= 0;
      // WebView2 может не дать автозапуск со звуком без жеста пользователя — тогда без звука.
      v.play().catch(() => {
        v.muted = true;
        v.play().catch(finish);
      });
    }
    return () => {
      window.removeEventListener("keydown", skip, true);
      window.removeEventListener("pointerdown", skip, true);
      window.clearTimeout(guard);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={leaving ? "intro-splash is-leaving" : "intro-splash"} aria-hidden="true">
      <video ref={video} className="intro-splash__video" src={introUrl} playsInline preload="auto" onEnded={finish} onError={finish} />
    </div>
  );
}
