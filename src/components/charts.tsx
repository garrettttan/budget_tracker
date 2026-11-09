import { useEffect, useRef, useState } from 'react';
import { round } from '../lib/cents';
import Button from './Button';

/*
 * Small hand-rolled SVG charts for Trends and Spending (no chart library).
 * Conventions: thin marks (columns <= 24px, 4px rounded tops, square at the baseline),
 * 2px lines, hairline solid gridlines, one y-axis, text in ink colors (never
 * the series color), a tooltip on hover AND keyboard focus, and each mark's
 * accessible name carries its value for screen readers.
 *
 * Series colors are CSS variables (--viz-income, --viz-spending, and
 * --viz-cat-1..6 for pie slices), validated for color-blind separation in
 * light and dark.
 */

export type Series = { name: string; color: string; values: number[] };

/** Width of an element, kept up to date, so SVG text renders at its real size. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round axis ticks: 0, 250, 500… covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(round(v));
  return ticks;
}

/** Axis labels: $0, $750, $1.5K, $12K. */
export function axisMoney(v: number): string {
  const a = Math.abs(v);
  const s = a >= 10_000 ? `${Math.round(a / 1000)}K` : a >= 1000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(Math.round(a));
  return `${v < 0 ? '−' : ''}$${s}`;
}

/** A column's path: 4px rounded top corners, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

type Tip = { x: number; y: number; title: string; rows: { color: string; name: string; value: string; dashed?: boolean }[] };

/** A line swatch's fill: solid, or dashed to match a dashed line. */
const lineSwatch = (color: string, dashed?: boolean) =>
  dashed ? { background: `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` } : { background: color };

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="presentation">
      <div className="chart-tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.name} className="chart-tip-row">
          <span className="chart-key-line" style={lineSwatch(r.color, r.dashed)} />
          <strong>{r.value}</strong> <span className="muted">{r.name}</span>
        </div>
      ))}
    </div>
  );
}

/** Legend for two or more series: a swatch shaped like the mark, then the name. */
export function Legend({ items, shape }: { items: { name: string; color: string; dashed?: boolean }[]; shape: 'rect' | 'line' }) {
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span key={i.name}>
          <span className={shape === 'rect' ? 'chart-key-rect' : 'chart-key-line'} style={shape === 'rect' ? { background: i.color } : lineSwatch(i.color, i.dashed)} />
          {i.name}
        </span>
      ))}
    </div>
  );
}

const PLOT_H = 200;
const AXIS_W = 52;
const X_BAND = 26;

/**
 * Monthly columns: one series, or two side by side (2px apart). Each month's
 * whole slot is the hover/focus/click target, and the tooltip lists every
 * series for that month.
 */
export function MonthColumns({
  months,
  series,
  format,
  label,
  selected,
  onSelect,
  selectHint,
}: {
  months: { key: string; short: string; long: string }[];
  series: Series[];
  format: (n: number) => string;
  /** accessible name for the chart */
  label: string;
  selected?: string | null;
  onSelect?: (monthKey: string) => void;
  /** what clicking a month does, for its accessible name */
  selectHint?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(0, max || 100);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - AXIS_W);
  const slot = months.length ? plotW / months.length : 0;
  const colW = Math.max(2, Math.min(24, (slot * 0.7 - 2 * (series.length - 1)) / series.length));
  const groupW = colW * series.length + 2 * (series.length - 1);
  const y = (v: number) => PLOT_H - (Math.max(0, v) / top) * PLOT_H;
  // thin out month labels when they'd collide (~34px each)
  const every = Math.max(1, Math.ceil(34 / Math.max(slot, 1)));

  function show(i: number, cx: number) {
    setHover(i);
    setTip({
      x: Math.min(Math.max(AXIS_W + cx, 80), Math.max(width - 80, 80)),
      y: 0,
      title: months[i].long,
      rows: series.map((s) => ({ color: s.color, name: s.name, value: format(s.values[i]) })),
    });
  }
  const hide = () => {
    setHover(null);
    setTip(null);
  };

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={PLOT_H + X_BAND + 8} role="group" aria-label={label}>
          <g transform="translate(0,8)">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)} className="chart-grid" />
                <text x={AXIS_W - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis">
                  {axisMoney(t)}
                </text>
              </g>
            ))}
            {months.map((m, i) => {
              const x0 = AXIS_W + i * slot + (slot - groupW) / 2;
              const cx = i * slot + slot / 2;
              const dim = (selected && selected !== m.key) || (hover !== null && hover !== i);
              return (
                <g key={m.key} className={dim ? 'chart-dim' : undefined}>
                  {series.map((s, j) => (
                    <path key={s.name} d={columnPath(x0 + j * (colW + 2), y(s.values[i]), colW, PLOT_H - y(s.values[i]))} style={{ fill: s.color }} />
                  ))}
                  {i % every === 0 && (
                    <text x={AXIS_W + cx} y={PLOT_H + 18} textAnchor="middle" className="chart-axis">
                      {m.short}
                    </text>
                  )}
                  <rect
                    x={AXIS_W + i * slot}
                    y={0}
                    width={slot}
                    height={PLOT_H + X_BAND}
                    className="chart-hit"
                    tabIndex={0}
                    role={onSelect ? 'button' : 'img'}
                    aria-label={`${m.long}: ${series.map((s) => `${s.name} ${format(s.values[i])}`).join(', ')}${onSelect && selectHint ? `. ${selectHint}` : ''}`}
                    onPointerEnter={() => show(i, cx)}
                    onPointerLeave={hide}
                    onFocus={() => show(i, cx)}
                    onBlur={hide}
                    onClick={() => onSelect?.(m.key)}
                    onKeyDown={(e) => {
                      if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onSelect(m.key);
                      }
                    }}
                  />
                </g>
              );
            })}
            <line x1={AXIS_W} x2={width} y1={PLOT_H} y2={PLOT_H} className="chart-baseline" />
          </g>
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

/**
 * Lines over time (net worth, categories by month): 2px lines with a crosshair
 * that snaps to the nearest point; the tooltip lists every series that month,
 * largest first. One series gets its latest value labeled at the end. With
 * `onSelect`, clicking (or Enter on) a point picks it.
 */
export function TimeLine({
  dates,
  series,
  format,
  label,
  onSelect,
  selectHint,
}: {
  dates: { date: string; long: string }[];
  /** `values[i]` is the value at `dates[i]` */
  series: { name: string; color: string; values: number[] }[];
  format: (n: number) => string;
  label: string;
  onSelect?: (date: string) => void;
  /** what clicking a point does, for the accessible name */
  selectHint?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [idx, setIdx] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const single = series.length === 1;
  const endLabelW = single ? 84 : 16;
  const plotW = Math.max(0, width - AXIS_W - endLabelW);
  const t0 = dates.length ? Date.parse(dates[0].date) : 0;
  const t1 = dates.length ? Date.parse(dates[dates.length - 1].date) : 1;
  const x = (d: string) => AXIS_W + (t1 === t0 ? plotW : ((Date.parse(d) - t0) / (t1 - t0)) * plotW);
  const y = (v: number) => PLOT_H - ((v - lo) / (hi - lo || 1)) * PLOT_H;
  const lastIdx = dates.length - 1;
  const last = dates[lastIdx];

  function nearest(px: number) {
    let best = 0;
    dates.forEach((p, i) => {
      if (Math.abs(x(p.date) - px) < Math.abs(x(dates[best].date) - px)) best = i;
    });
    return best;
  }

  const tip: Tip | null =
    idx === null
      ? null
      : {
          x: Math.min(Math.max(x(dates[idx].date), 80), Math.max(width - 80, 80)),
          y: 0,
          title: dates[idx].long,
          rows: [...series]
            .sort((a, b) => b.values[idx] - a.values[idx])
            .map((s) => ({ color: s.color, name: s.name, value: format(s.values[idx]) })),
        };

  return (
    <div className="chart" ref={ref}>
      {width > 0 && dates.length > 0 && (
        <svg
          width={width}
          height={PLOT_H + X_BAND + 8}
          role={onSelect ? 'button' : 'img'}
          aria-label={onSelect && selectHint ? `${label}. Arrow keys move between months; ${selectHint.toLowerCase()}` : label}
          tabIndex={0}
          className={onSelect ? 'clickable' : undefined}
          onClick={(e) => onSelect?.(dates[nearest(e.clientX - e.currentTarget.getBoundingClientRect().left)].date)}
          onPointerMove={(e) => setIdx(nearest(e.clientX - e.currentTarget.getBoundingClientRect().left))}
          onPointerLeave={() => setIdx(null)}
          onFocus={() => setIdx(lastIdx)}
          onBlur={() => setIdx(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, (i ?? lastIdx) - 1));
            if (e.key === 'ArrowRight') setIdx((i) => Math.min(lastIdx, (i ?? 0) + 1));
            if (onSelect && idx !== null && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onSelect(dates[idx].date);
            }
          }}
        >
          <g transform="translate(0,8)">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={AXIS_W} x2={AXIS_W + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-baseline' : 'chart-grid'} />
                <text x={AXIS_W - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis">
                  {axisMoney(t)}
                </text>
              </g>
            ))}
            <text x={AXIS_W} y={PLOT_H + 18} className="chart-axis">
              {dates[0].long}
            </text>
            {dates.length > 1 && (
              <text x={AXIS_W + plotW} y={PLOT_H + 18} textAnchor="end" className="chart-axis">
                {last.long}
              </text>
            )}
            {idx !== null && <line x1={x(dates[idx].date)} x2={x(dates[idx].date)} y1={0} y2={PLOT_H} className="chart-crosshair" />}
            {series.map((s) => (
              <g key={s.name}>
                {dates.length > 1 && (
                  <path
                    d={dates.map((p, i) => `${i ? 'L' : 'M'}${x(p.date)},${y(s.values[i])}`).join('')}
                    className="chart-line"
                    style={{ stroke: s.color }}
                  />
                )}
                <circle cx={x(last.date)} cy={y(s.values[lastIdx])} r={4} className="chart-dot" style={{ fill: s.color }} />
                {idx !== null && idx !== lastIdx && (
                  <circle cx={x(dates[idx].date)} cy={y(s.values[idx])} r={4} className="chart-dot" style={{ fill: s.color }} />
                )}
              </g>
            ))}
            {single && (
              <text x={x(last.date) + 10} y={y(series[0].values[lastIdx])} dy="0.32em" className="chart-end-label">
                {format(series[0].values[lastIdx])}
              </text>
            )}
          </g>
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

export type PaceSeries = { name: string; color: string; dashed?: boolean; values: (number | null)[] };

/**
 * Running totals through a month, day by day: one line per series (day 1 is
 * values[0]; null = no value that day, e.g. days still to come). The first
 * series is the main one: it gets the end dot and label. Hover and arrow keys
 * snap a crosshair to a day; the tooltip lists every series' total that day.
 */
export function PaceLines({
  days,
  series,
  format,
  label,
  dayLabel,
}: {
  days: number;
  series: PaceSeries[];
  format: (n: number) => string;
  label: string;
  /** "Nov 12" for a day number */
  dayLabel: (day: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [idx, setIdx] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const endLabelW = 84;
  const plotW = Math.max(0, width - AXIS_W - endLabelW);
  const x = (i: number) => AXIS_W + (days > 1 ? (i / (days - 1)) * plotW : plotW);
  const y = (v: number) => PLOT_H - ((v - lo) / (hi - lo || 1)) * PLOT_H;
  const path = (values: (number | null)[]) =>
    values
      .map((v, i) => (v === null ? null : `${i && values[i - 1] !== null ? 'L' : 'M'}${x(i)},${y(v)}`))
      .filter(Boolean)
      .join('');
  const main = series[0];
  const lastIdx = main ? main.values.reduce<number>((last, v, i) => (v === null ? last : i), -1) : -1;
  const focusIdx = lastIdx >= 0 ? lastIdx : days - 1;
  const nearest = (px: number) => Math.min(days - 1, Math.max(0, Math.round(((px - AXIS_W) / (plotW || 1)) * (days - 1))));

  const tip: Tip | null =
    idx === null
      ? null
      : {
          x: Math.min(Math.max(x(idx), 80), Math.max(width - 80, 80)),
          y: 0,
          title: dayLabel(idx + 1),
          rows: series
            .filter((s) => s.values[idx] != null)
            .map((s) => ({ color: s.color, dashed: s.dashed, name: s.name, value: format(s.values[idx]!) })),
        };

  return (
    <div className="chart" ref={ref}>
      {width > 0 && days > 0 && (
        <svg
          width={width}
          height={PLOT_H + X_BAND + 8}
          role="img"
          aria-label={`${label}. Arrow keys move between days`}
          tabIndex={0}
          onPointerMove={(e) => setIdx(nearest(e.clientX - e.currentTarget.getBoundingClientRect().left))}
          onPointerLeave={() => setIdx(null)}
          onFocus={() => setIdx(focusIdx)}
          onBlur={() => setIdx(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, (i ?? focusIdx) - 1));
            if (e.key === 'ArrowRight') setIdx((i) => Math.min(days - 1, (i ?? focusIdx) + 1));
          }}
        >
          <g transform="translate(0,8)">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={AXIS_W} x2={AXIS_W + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-baseline' : 'chart-grid'} />
                <text x={AXIS_W - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis">
                  {axisMoney(t)}
                </text>
              </g>
            ))}
            <text x={AXIS_W} y={PLOT_H + 18} className="chart-axis">
              {dayLabel(1)}
            </text>
            <text x={AXIS_W + plotW} y={PLOT_H + 18} textAnchor="end" className="chart-axis">
              {dayLabel(days)}
            </text>
            {/* the main series last, so it draws on top */}
            {[...series].reverse().map((s) => (
              <path key={s.name} d={path(s.values)} className={s.dashed ? 'chart-line dashed' : 'chart-line'} style={{ stroke: s.color }} />
            ))}
            {idx !== null && <line x1={x(idx)} x2={x(idx)} y1={0} y2={PLOT_H} className="chart-crosshair" />}
            {idx !== null &&
              series.map((s) =>
                s.values[idx] == null || (s === main && idx === lastIdx) ? null : (
                  <circle key={s.name} cx={x(idx)} cy={y(s.values[idx]!)} r={4} className="chart-dot" style={{ fill: s.color }} />
                ),
              )}
            {main && lastIdx >= 0 && (
              <>
                <circle cx={x(lastIdx)} cy={y(main.values[lastIdx]!)} r={4} className="chart-dot" style={{ fill: main.color }} />
                <text x={x(lastIdx) + 10} y={y(main.values[lastIdx]!)} dy="0.32em" className="chart-end-label">
                  {format(main.values[lastIdx]!)}
                </text>
              </>
            )}
          </g>
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

/** Slice colors in fixed order (validated adjacent-pair color-blind separation, light and dark). */
export const SLICE_COLORS = ['var(--viz-cat-1)', 'var(--viz-cat-2)', 'var(--viz-cat-3)', 'var(--viz-cat-4)', 'var(--viz-cat-5)', 'var(--viz-cat-6)'];
export const OTHER_COLOR = 'var(--viz-cat-other)';

export type Slice = { key: string; name: string; value: number; color: string };

// drawing units; the SVG scales to its column (up to 440px across)
const PIE_R = 200;
const PIE_HOLE = 126;

/** A donut segment from angle a0 to a1 (radians, 0 = 12 o'clock, clockwise). */
function arcPath(a0: number, a1: number, r: number, hole: number): string {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4; // a lone slice: a near-full ring
  const pt = (a: number, rad: number) => `${PIE_R + 4 + rad * Math.sin(a)},${PIE_R + 4 - rad * Math.cos(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(a0, r)}A${r},${r} 0 ${large} 1 ${pt(a1, r)}L${pt(a1, hole)}A${hole},${hole} 0 ${large} 0 ${pt(a0, hole)}Z`;
}

type Arc = Slice & { a0: number; a1: number };

/**
 * Slices that move to new angles (another month, an edit) slide there over
 * `ms` instead of snapping; new ones grow from nothing, gone ones shrink away.
 * Off when the device asks for reduced motion.
 */
function useTweenedArcs(target: Arc[], ms = 250): Arc[] {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  const signature = target.map((a) => `${a.key}:${a.a0.toFixed(4)}:${a.a1.toFixed(4)}:${a.color}:${a.value}`).join('|');
  useEffect(() => {
    const from = current.current;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || from.length === 0) {
      current.current = target;
      setShown(target);
      return;
    }
    const before = new Map(from.map((a) => [a.key, a]));
    const after = new Set(target.map((a) => a.key));
    const tracks = [
      ...target.map((t) => ({ arc: t, f: before.get(t.key) ?? { ...t, a1: t.a0 }, t })),
      ...from.filter((f) => !after.has(f.key)).map((f) => ({ arc: f, f, t: { ...f, a1: f.a0 } })),
    ];
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const e = 1 - (1 - p) ** 3; // ease out
      const frame = p < 1 ? tracks.map(({ arc, f, t }) => ({ ...arc, a0: f.a0 + (t.a0 - f.a0) * e, a1: f.a1 + (t.a1 - f.a1) * e })) : target;
      current.current = frame;
      setShown(frame);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [signature]);
  return shown;
}

/**
 * Part-to-whole donut with a ranked list beside it. The list carries every
 * name, amount and share (so color is never the only key and no hover is
 * needed); the donut shows the split at a glance. Slices beyond the colored
 * ones share the gray "Other" slice, but each still has its own list row.
 * Hovering a slice or a row highlights both; rows are the buttons.
 * Filtered-out categories (`hidden`) keep their place and size, faded, so
 * filtering never reshapes the chart or shifts the page.
 */
export function CategoryPie({
  rows,
  format,
  total,
  selected,
  hidden = [],
  onSelect,
  selectHint,
  label,
  listHeader,
  reserveRows,
}: {
  rows: { key: string; name: string; value: number }[];
  format: (n: number) => string;
  total: number;
  selected?: string | null;
  /** keys filtered out: drawn faded, in place */
  hidden?: string[];
  onSelect: (key: string) => void;
  selectHint: string;
  label: string;
  /** controls above the ranked list (e.g. what the slices are) */
  listHeader?: React.ReactNode;
  /** another set of rows the list keeps room for (drawn invisibly behind it), so switching to it never moves the list's header */
  reserveRows?: { key: string; name: string; value: number }[];
}) {
  const [hover, setHover] = useState<string | null>(null);
  // more than six categories: the sixth slot onward folds into Other
  const colored = rows.length > SLICE_COLORS.length ? rows.slice(0, SLICE_COLORS.length - 1) : rows;
  const rest = rows.slice(colored.length);
  const slices: Slice[] = colored.map((r, i) => ({ ...r, color: SLICE_COLORS[i] }));
  if (rest.length) slices.push({ key: 'other', name: `Other (${rest.length})`, value: rest.reduce((a, r) => a + r.value, 0), color: OTHER_COLOR });
  const sliceOf = (key: string) => (rest.some((r) => r.key === key) ? 'other' : key);
  // Other is faded only when everything folded into it is
  const faded = (key: string) => (key === 'other' ? rest.every((r) => hidden.includes(r.key)) : hidden.includes(key));
  const whole = slices.reduce((a, s) => a + s.value, 0) || 1;
  const share = (v: number) => `${Math.round((v / whole) * 100)}%`;

  let angle = 0;
  const arcs: Arc[] = slices.map((s) => {
    const a0 = angle;
    angle += (s.value / whole) * Math.PI * 2;
    return { ...s, a0, a1: angle };
  });
  const drawn = useTweenedArcs(arcs);
  const hot = hover ? sliceOf(hover) : null;
  const picked = selected ? sliceOf(selected) : null;
  const tipArc = arcs.find((a) => a.key === hot);
  const mid = tipArc ? (tipArc.a0 + tipArc.a1) / 2 : 0;
  const size = (PIE_R + 4) * 2;

  return (
    <div className="pie-layout">
      <div className="chart pie">
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${slices.map((s) => `${s.name} ${share(s.value)}`).join(', ')}`}>
          {drawn.map((a) => (
            <path
              key={a.key}
              d={arcPath(a.a0, a.a1, a.key === picked ? PIE_R + 4 : PIE_R, PIE_HOLE)}
              className={`pie-slice${faded(a.key) ? ' faded' : ''}${hot && hot !== a.key ? ' dim' : ''}${a.key === 'other' ? '' : ' clickable'}`}
              style={{ fill: a.color }}
              onPointerEnter={() => setHover(a.key)}
              onPointerLeave={() => setHover(null)}
              onClick={() => a.key !== 'other' && onSelect(a.key)}
            />
          ))}
          <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" className="pie-total">
            {format(total)}
          </text>
        </svg>
        {tipArc && (
          <div
            className="chart-tip"
            role="presentation"
            style={{
              left: `${(0.5 + ((PIE_R - 20) * Math.sin(mid)) / size) * 100}%`,
              top: `${(0.5 - ((PIE_R - 20) * Math.cos(mid)) / size) * 100}%`,
              // open toward the middle, so a slice near the edge never pushes the tip off a phone screen
              transform: `translate(${Math.sin(mid) > 0.25 ? '-100%' : Math.sin(mid) < -0.25 ? '0' : '-50%'}, -100%)`,
            }}
          >
            <div className="chart-tip-row">
              <span className="chart-key-rect" style={{ background: tipArc.color }} />
              <strong>{format(tipArc.value)}</strong> <span className="muted">{tipArc.name} · {share(tipArc.value)}</span>
            </div>
          </div>
        )}
      </div>
      <div className="pie-side">
        {listHeader}
        <div className="pie-lists">
          {reserveRows && (
            <ul className="pie-list pie-reserve" aria-hidden="true">
              {reserveRows.map((r) => (
                <li key={r.key}>
                  <span className="btn btn-link pie-row">
                    <span className="chart-key-rect" />
                    <span className="pie-name">{r.name}</span>
                    <span className="pie-share">{share(r.value)}</span>
                    <span className="pie-value">{format(r.value)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ul className="pie-list">
            {rows.map((r) => {
              const color = slices.find((s) => s.key === sliceOf(r.key))!.color;
              return (
                <li key={r.key}>
                  <Button
                    variant="link"
                    className={`pie-row${selected === r.key ? ' selected' : ''}${hidden.includes(r.key) ? ' faded' : ''}${hot && hot !== sliceOf(r.key) ? ' dim' : ''}`}
                    aria-pressed={selected === r.key}
                    aria-label={`${r.name}: ${format(r.value)}, ${share(r.value)}. ${selectHint}`}
                    onPointerEnter={() => setHover(r.key)}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover(r.key)}
                    onBlur={() => setHover(null)}
                    onClick={() => onSelect(r.key)}
                  >
                    <span className="chart-key-rect" style={{ background: color }} />
                    <span className="pie-name">{r.name}</span>
                    <span className="pie-share">{share(r.value)}</span>
                    <span className="pie-value">{format(r.value)}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
