import { useCallback, useEffect, useState } from "react";
import { BackIcon, Focusable, FocusGroup, Spinner } from "@kinonyx/ui";
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
    <FocusGroup focusKey="diagnostics" className="settings screen-pad">
      <header className="settings__head">
        <Focusable
          as="button"
          className="back-btn"
          focusKey="diagnostics:back"
          autoFocus
          onPress={() => back() || navigate({ name: "home" })}
          scrollBlock="start"
        >
          <BackIcon size={18} />
          Назад
        </Focusable>
        <h1 className="settings__title">Диагностика</h1>
        <span />
      </header>

      {!checks && !error && (
        <div className="diag__loading">
          <Spinner /> Проверяю…
        </div>
      )}
      {error && <div className="settings__hint settings__hint--error">{error}</div>}

      {checks && (
        <ul className="diag__list">
          {checks.map((c) => (
            <li key={c.id} className={`diag__row diag__row--${c.status}`}>
              <span className="diag__dot" aria-hidden />
              <div className="diag__body">
                <div className="diag__label">
                  {c.label} <span className="diag__badge">{STATUS_LABEL[c.status]}</span>
                </div>
                <div className="diag__detail">{c.detail}</div>
                {c.hint && c.status !== "ok" && <div className="diag__hint">{c.hint}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="setup__actions">
        <Focusable as="button" className="btn btn--primary" focusKey="diagnostics:rerun" onPress={run}>
          Проверить ещё раз
        </Focusable>
        <Focusable as="button" className="btn" focusKey="diagnostics:copy" onPress={() => void copy()}>
          {copied ? "Скопировано" : "Копировать отчёт"}
        </Focusable>
      </div>
    </FocusGroup>
  );
}
