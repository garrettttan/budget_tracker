import { type ReactNode, useEffect, useRef, useState } from 'react';
import Button from './Button';

/*
 * Small hand-rolled SVG charts for Trends. Rules (see the dataviz notes in the
 * PR): thin marks (columns <= 24px, 4px rounded tops, square at the baseline),
 * 2px lines, hairline solid gridlines, one y-axis, text in ink colors (never
 * the series color), a tooltip on hover AND keyboard focus that never gates a
 * value (every chart has a table view beside it).
 *
 * Series colors are CSS variables (--viz-income, --viz-spending), validated
 * for color-blind separation in light and dark.
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
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
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

type Tip = { x: number; y: number; title: string; rows: { color: string; name: string; value: string }[] };

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="presentation">
      <div className="chart-tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.name} className="chart-tip-row">
          <span className="chart-key-line" style={{ background: r.color }} />
          <strong>{r.value}</strong> <span className="muted">{r.name}</span>
        </div>
      ))}
    </div>
  );
}

/** Legend for two or more series: a swatch shaped like the mark, then the name. */
export function Legend({ items, shape }: { items: { name: string; color: string }[]; shape: 'rect' | 'line' }) {
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span key={i.name}>
          <span className={shape === 'rect' ? 'chart-key-rect' : 'chart-key-line'} style={{ background: i.color }} />
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
 * One series over time (net worth): a 2px line with a crosshair that snaps to
 * the nearest point, and the latest value labeled at the end.
 */
export function TimeLine({
  points,
  color,
  format,
  label,
}: {
  points: { date: string; long: string; value: number }[];
  color: string;
  format: (n: number) => string;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [idx, setIdx] = useState<number | null>(null);
  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const endLabelW = 84;
  const plotW = Math.max(0, width - AXIS_W - endLabelW);
  const t0 = points.length ? Date.parse(points[0].date) : 0;
  const t1 = points.length ? Date.parse(points[points.length - 1].date) : 1;
  const x = (d: string) => AXIS_W + (t1 === t0 ? plotW : ((Date.parse(d) - t0) / (t1 - t0)) * plotW);
  const y = (v: number) => PLOT_H - ((v - lo) / (hi - lo || 1)) * PLOT_H;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date)},${y(p.value)}`).join('');
  const last = points[points.length - 1];

  function nearest(px: number) {
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.date) - px) < Math.abs(x(points[best].date) - px)) best = i;
    });
    return best;
  }

  const tip: Tip | null =
    idx === null
      ? null
      : {
          x: Math.min(Math.max(x(points[idx].date), 80), Math.max(width - 80, 80)),
          y: 0,
          title: points[idx].long,
          rows: [{ color, name: 'Net worth', value: format(points[idx].value) }],
        };

  return (
    <div className="chart" ref={ref}>
      {width > 0 && points.length > 0 && (
        <svg
          width={width}
          height={PLOT_H + X_BAND + 8}
          role="img"
          aria-label={label}
          tabIndex={0}
          onPointerMove={(e) => setIdx(nearest(e.clientX - e.currentTarget.getBoundingClientRect().left))}
          onPointerLeave={() => setIdx(null)}
          onFocus={() => setIdx(points.length - 1)}
          onBlur={() => setIdx(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, (i ?? points.length - 1) - 1));
            if (e.key === 'ArrowRight') setIdx((i) => Math.min(points.length - 1, (i ?? 0) + 1));
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
              {points[0].long}
            </text>
            {points.length > 1 && (
              <text x={AXIS_W + plotW} y={PLOT_H + 18} textAnchor="end" className="chart-axis">
                {last.long}
              </text>
            )}
            {points.length > 1 && <path d={path} className="chart-line" style={{ stroke: color }} />}
            {idx !== null && <line x1={x(points[idx].date)} x2={x(points[idx].date)} y1={0} y2={PLOT_H} className="chart-crosshair" />}
            <circle cx={x(last.date)} cy={y(last.value)} r={4} className="chart-dot" style={{ fill: color }} />
            {idx !== null && idx !== points.length - 1 && (
              <circle cx={x(points[idx].date)} cy={y(points[idx].value)} r={4} className="chart-dot" style={{ fill: color }} />
            )}
            <text x={x(last.date) + 10} y={y(last.value)} dy="0.32em" className="chart-end-label">
              {format(last.value)}
            </text>
          </g>
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

/**
 * Ranked horizontal bars, largest first, one hue. Names and values are
 * printed, so the bars are their own table. Each row is a button.
 */
export function RankedBars({
  rows,
  color,
  format,
  selected,
  onSelect,
  selectHint,
}: {
  rows: { key: string; name: string; value: number }[];
  color: string;
  format: (n: number) => string;
  selected?: string | null;
  onSelect: (key: string) => void;
  selectHint: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value)) || 1;
  return (
    <ul className="ranked-bars">
      {rows.map((r) => (
        <li key={r.key}>
          <Button
            variant="link"
            className={`ranked-row${selected === r.key ? ' selected' : ''}`}
            aria-pressed={selected === r.key}
            aria-label={`${r.name}: ${format(r.value)}. ${selectHint}`}
            onClick={() => onSelect(r.key)}
          >
            <span className="ranked-name">{r.name}</span>
            <span className="ranked-track">
              <span className="ranked-bar" style={{ width: `${(Math.max(0, r.value) / max) * 100}%`, background: color }} />
            </span>
            <span className="ranked-value">{format(r.value)}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** "Show as table": the chart's values without hovering. */
export function TableView({ children }: { children: ReactNode }) {
  return (
    <details className="chart-table">
      <summary>Show as table</summary>
      {children}
    </details>
  );
}
