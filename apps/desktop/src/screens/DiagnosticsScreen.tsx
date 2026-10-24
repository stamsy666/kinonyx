import { useCallback, useEffect, useState } from "react";
import { AboutIcon, BackIcon, Focusable, FocusGroup, NextIcon, Spinner } from "@kinonyx/ui";
import { HomeChrome } from "../components/HomeChrome";
import { useApp } from "../store/app";
import { runDiagnostics, type DiagnosticCheck } from "../data/api";

const STATUS_LABEL = { ok: "OK", warn: "Внимание", fail: "Проблема" } as const;

/** Plain-text report for a bug report/screenshot. Detail strings come from Rust and never
 *  contain a full key (the key checks only say "принят" / why not). */
function reportText(checks: DiagnosticCheck[]) {
  const lines = checks.map(
    (c) => `[${STATUS_LABEL[c.status]}] ${c.label}: ${c.detail}${c.hint ? ` — ${c.hint}` : ""}`,
  );
  return `KINONYX — диагностика\n${new Date().toLocaleString("ru-RU")}\n\n${lines.join("\n")}`;
}

export function DiagnosticsScreen() {
  const back = useApp((s) => s.back);
  const navigate = useApp((s) => s.navigate);
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = useCallback(() => {
    setChecks(null);
    setError(null);
    setCopied(false);
    runDiagnostics().then(setChecks, (e) => setError(String(e)));
  }, []);

  useEffect(run, [run]);

  const copy = async () => {
    if (!checks) return;
    try {
      await navigator.clipboard.writeText(reportText(checks));
      setCopied(true);
    } catch {
      setError("Не удалось скопировать — выделите текст вручную");
    }
  };

  return (
    <FocusGroup focusKey="diagnostics" className="settings screen-pad home home--tv home--nohero settings--tv">
      <HomeChrome id="diagnostics" label="Диагностика" hideSearch />

      <div className="stx">
        <div className="stx__stage">
          <div className="stx__art">
            <AboutIcon size={300} strokeWidth={1} />
          </div>
          <p className="stx__desc">Что работает, а что нет: ключи, сеть, торрент-сервер и плеер.</p>
        </div>

        <div className="stx__list">
          <div className="settings-pane">
            <Focusable
              as="button"
              back
              focusKey="diagnostics:back"
              className="stx__row stx__back"
              autoFocus
              onPress={() => back() || navigate({ name: "home" })}
            >
              <span className="stx__row-icon">
                <BackIcon size={22} />
              </span>
              <span className="stx__row-label">Назад</span>
            </Focusable>

            {!checks && !error && (
              <div className="diag__loading">
                <Spinner /> Проверяю…
              </div>
            )}
            {error && <div className="settings__hint settings__hint--error">{error}</div>}

            {checks && (
              <section className="settings__item">
                <div className="settings__label">Проверки</div>
                {checks.map((c) => (
                  <div className="diag-item" key={c.id}>
                    <Focusable as="button" focusKey={`diagnostics:${c.id}`} className={`stx__row diag-pill diag-pill--${c.status}`}>
                      <i className="diag-pill__dot" aria-hidden />
                      <span className="stx__row-label">{c.label}</span>
                      <span className="diag-pill__detail">{c.detail}</span>
                      <span className="diag-pill__badge">{STATUS_LABEL[c.status]}</span>
                    </Focusable>
                    {c.hint && c.status !== "ok" && <div className="settings__hint">{c.hint}</div>}
                  </div>
                ))}
              </section>
            )}

            <section className="settings__item">
              <Focusable as="button" className="cycle-row" focusKey="diagnostics:rerun" onPress={run}>
                <span className="cycle-row__label">Проверить ещё раз</span>
                <NextIcon size={20} />
              </Focusable>
              <Focusable as="button" className="cycle-row" focusKey="diagnostics:copy" onPress={() => void copy()}>
                <span className="cycle-row__label">Копировать отчёт</span>
                <span className="cycle-row__value">{copied ? "Скопировано" : ""}</span>
                <NextIcon size={20} />
              </Focusable>
            </section>
          </div>
        </div>
      </div>
    </FocusGroup>
  );
}
