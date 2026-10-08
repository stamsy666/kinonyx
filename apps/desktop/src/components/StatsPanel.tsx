import { useMemo, useState } from "react";
import { Focusable, FlameIcon, StatsIcon, TrophyIcon } from "@kinonyx/ui";
import { useApp } from "../store/app";
import {
  favouriteTime,
  formatDuration,
  lastDays,
  streak,
  totalOf,
  useWatchStats,
  type StatKind,
} from "../store/watchStats";

const KIND_LABEL: Record<StatKind, string> = { movie: "Фильмы", series: "Сериалы", tv: "Телеканалы" };
const KIND_COLOR: Record<StatKind, string> = { movie: "var(--accent)", series: "var(--teal)", tv: "#e0b341" };
const dayMonth = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Settings → Статистика: what was watched, when, and how much — all computed on this computer
 *  from the time the players actually spent playing (store/watchStats.ts). */
export function StatsPanel() {
  const navigate = useApp((s) => s.navigate);
  const { days, titles, genres, hours, reset } = useWatchStats();
  const [confirmReset, setConfirmReset] = useState(false);

  const stats = useMemo(() => {
    const all = Object.values(days);
    const total = all.reduce((a, d) => a + totalOf(d), 0);
    const by = { movie: 0, series: 0, tv: 0 } as Record<StatKind, number>;
    for (const d of all) {
      by.movie += d.movie;
      by.series += d.series;
      by.tv += d.tv;
    }
    const week = lastDays(days, 7);
    const month = lastDays(days, 30);
    const chart = lastDays(days, 14);
    return {
      total,
      by,
      today: week[week.length - 1].seconds,
      week: week.reduce((a, d) => a + d.seconds, 0),
      month: month.reduce((a, d) => a + d.seconds, 0),
      chart,
      chartMax: Math.max(60, ...chart.map((d) => d.seconds)),
      streak: streak(days),
      topTitles: Object.entries(titles)
        .sort((a, b) => b[1].seconds - a[1].seconds)
        .slice(0, 5),
      topGenres: Object.entries(genres)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6),
      time: favouriteTime(hours),
    };
  }, [days, titles, genres, hours]);

  // Anything counted at all (a few seconds is enough) — it used to wait for a full minute, so a
  // 20-second watch still showed the empty "here will be your statistics" screen.
  const hasData = stats.total >= 5;
  const share = (k: StatKind) => (stats.total ? stats.by[k] / stats.total : 0);
  const donut = (() => {
    let acc = 0;
    const parts = (Object.keys(KIND_LABEL) as StatKind[]).map((k) => {
      const from = acc;
      acc += share(k) * 100;
      return `${KIND_COLOR[k]} ${from}% ${acc}%`;
    });
    return `conic-gradient(${parts.join(", ")})`;
  })();

  return (
    <>
      {!hasData ? (
        <div className="settings-empty">
          <StatsIcon size={44} />
          <p>Здесь появится ваша статистика</p>
          <span>
            Посмотрите что-нибудь — фильм, серию или канал, — и тут будет время просмотра, любимые жанры и серия дней подряд.
          </span>
        </div>
      ) : (
        <>
          <Focusable as="div" focusKey="stats:hero" scrollBlock="nearest" className="stats-hero stats-focus">
            <div>
              <div className="stats-hero__label">Всего просмотрено</div>
              <div className="stats-hero__value">{formatDuration(stats.total)}</div>
              <div className="stats-hero__sub">
                {stats.time ? `Чаще всего вы смотрите: ${stats.time.toLowerCase()}` : "Продолжайте — картина станет точнее"}
              </div>
            </div>
            <div className="stats-streak" title="Дней подряд с просмотром">
              <FlameIcon size={30} />
              <b>{stats.streak}</b>
              <span>{stats.streak === 1 ? "день подряд" : "дней подряд"}</span>
            </div>
          </Focusable>

          <Focusable as="div" focusKey="stats:tiles" scrollBlock="nearest" className="stats-tiles stats-focus">
            <div className="stats-tile">
              <span>Сегодня</span>
              <b>{formatDuration(stats.today)}</b>
            </div>
            <div className="stats-tile">
              <span>За 7 дней</span>
              <b>{formatDuration(stats.week)}</b>
            </div>
            <div className="stats-tile">
              <span>За 30 дней</span>
              <b>{formatDuration(stats.month)}</b>
            </div>
          </Focusable>

          <Focusable as="div" focusKey="stats:chart" scrollBlock="nearest" className="settings__item stats-focus">
            <div className="settings__label">Последние 14 дней</div>
            <div className="stats-chart" role="img" aria-label="Время просмотра по дням">
              {stats.chart.map((d, i) => {
                const isToday = i === stats.chart.length - 1;
                return (
                  <div
                    className="stats-chart__col"
                    key={d.date.toISOString()}
                    title={`${d.date.toLocaleDateString("ru-RU")} — ${formatDuration(d.seconds)}`}
                  >
                    <div className="stats-chart__bar-wrap">
                      <div
                        className={`stats-chart__bar ${isToday ? "is-today" : ""}`}
                        style={{ height: `${Math.max(d.seconds > 0 ? 4 : 0, (d.seconds / stats.chartMax) * 100)}%` }}
                      />
                    </div>
                    <span className="stats-chart__day">{dayMonth(d.date)}</span>
                  </div>
                );
              })}
            </div>
          </Focusable>

          <div className="stats-two">
            <Focusable as="div" focusKey="stats:split" scrollBlock="nearest" className="settings__item stats-focus">
              <div className="settings__label">Что вы смотрите</div>
              <div className="stats-split">
                <div className="stats-donut" style={{ background: donut }} aria-hidden />
                <ul className="stats-legend">
                  {(Object.keys(KIND_LABEL) as StatKind[]).map((k) => (
                    <li key={k}>
                      <i style={{ background: KIND_COLOR[k] }} />
                      <span>{KIND_LABEL[k]}</span>
                      <b>{Math.round(share(k) * 100)}%</b>
                    </li>
                  ))}
                </ul>
              </div>
            </Focusable>

            <Focusable as="div" focusKey="stats:genres" scrollBlock="nearest" className="settings__item stats-focus">
              <div className="settings__label">Любимые жанры</div>
              <ul className="stats-bars">
                {stats.topGenres.length === 0 && <li className="settings__hint">Жанры появятся после просмотра фильмов.</li>}
                {stats.topGenres.map(([name, sec]) => (
                  <li key={name}>
                    <span>{name}</span>
                    <div className="stats-bars__track">
                      <i style={{ width: `${(sec / stats.topGenres[0][1]) * 100}%` }} />
                    </div>
                    <b>{formatDuration(sec)}</b>
                  </li>
                ))}
              </ul>
            </Focusable>
          </div>

          <section className="settings__item">
            <div className="settings__label">
              <TrophyIcon size={20} /> Больше всего времени
            </div>
            <div className="stats-top">
              {stats.topTitles.map(([key, t], i) => (
                <Focusable
                  as="button"
                  key={key}
                  focusKey={`stats:top:${i}`}
                  className="stats-top__item"
                  onPress={() => t.filmId && navigate({ name: "movie", id: t.filmId })}
                >
                  <span className="stats-top__rank">{i + 1}</span>
                  {t.poster ? <img src={t.poster} alt="" /> : <span className="stats-top__noimg" />}
                  <span className="stats-top__text">
                    <span className="stats-top__title">{t.title}</span>
                    <span className="stats-top__sub">
                      {KIND_LABEL[t.kind]} · {formatDuration(t.seconds)}
                    </span>
                  </span>
                </Focusable>
              ))}
            </div>
          </section>

          <div className="stats-footer">
            <Focusable
              as="button"
              className="credit"
              focusKey="stats:reset"
              onPress={() => {
                if (confirmReset) {
                  reset();
                  setConfirmReset(false);
                } else setConfirmReset(true);
              }}
            >
              {confirmReset ? "Точно сбросить? Нажмите ещё раз" : "Сбросить статистику"}
            </Focusable>
          </div>
        </>
      )}
    </>
  );
}
