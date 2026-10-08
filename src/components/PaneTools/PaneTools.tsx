import './PaneTools.css';

export type RunTone = 'running' | 'stopped' | 'waiting';

interface RunStatusProps {
  tone: RunTone;
  label: string;
}

/** The state of a tool pane as a coloured pill: green running, amber waiting, grey stopped. */
export function RunStatus({ tone, label }: RunStatusProps) {
  return (
    <span className={`pt-status ${tone}`} role="status">
      <span className="pt-status-dot" />
      {label}
    </span>
  );
}

interface RunButtonProps {
  running: boolean;
  startLabel: string;
  stopLabel: string;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
}

/** Start while stopped, Stop while running. Sits right of its `RunStatus`. */
export function RunButton({ running, startLabel, stopLabel, onStart, onStop, disabled }: RunButtonProps) {
  return running ? (
    <button type="button" className="pt-run-btn stop" onClick={onStop} disabled={disabled}>
      <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><rect width="10" height="10" rx="1" /></svg>
      {stopLabel}
    </button>
  ) : (
    <button type="button" className="pt-run-btn start" onClick={onStart} disabled={disabled}>
      <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><polygon points="0,0 10,5 0,10" /></svg>
      {startLabel}
    </button>
  );
}

export interface SegmentOption<T> {
  value: T;
  label: string;
}

interface SegmentedProps<T> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}

/** Joined buttons for a small fixed choice; a press takes effect at once. */
export function Segmented<T extends string | number>({ options, value, onChange, ariaLabel, disabled }: SegmentedProps<T>) {
  return (
    <div className="pt-seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={`pt-seg-btn${o.value === value ? ' active' : ''}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          disabled={disabled}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface BarSparklineProps {
  /** Oldest first. A number is a reply time; null is a missed reply. */
  values: readonly (number | null)[];
  slots?: number;
  width?: number;
  height?: number;
}

/**
 * One bar per probe, newest at the right edge. A missed probe is a full-height
 * red bar, so loss stands out even when the replies around it are fast.
 */
export function BarSparkline({ values, slots = 60, width = 120, height = 18 }: BarSparklineProps) {
  const shown = values.slice(-slots);
  const barW = width / slots;
  const max = Math.max(1, ...shown.filter((v): v is number => v !== null));
  const offset = slots - shown.length;
  return (
    <svg className="pt-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {shown.map((v, i) => {
        const x = (offset + i) * barW;
        if (v === null) {
          return <rect key={i} className="pt-spark-fail" x={x} y={0} width={Math.max(0.5, barW - 0.4)} height={height} />;
        }
        const h = Math.max(2, (v / max) * height);
        return <rect key={i} className="pt-spark-ok" x={x} y={height - h} width={Math.max(0.5, barW - 0.4)} height={h} />;
      })}
    </svg>
  );
}

interface LineSparklineProps {
  /** Oldest first. `undefined` (no value that poll) breaks nothing; it is skipped. */
  values: readonly (number | undefined)[];
  slots?: number;
  width?: number;
  height?: number;
  /** Paint it in the warning colour. */
  hot?: boolean;
}

/** A filled line, newest point at the right edge and marked with a dot. */
export function LineSparkline({ values, slots = 30, width = 72, height = 18, hot }: LineSparklineProps) {
  const shown = values.slice(-slots);
  const points: [number, number][] = [];
  const max = Math.max(0, ...shown.filter((v): v is number => v !== undefined));
  const step = (width - 3) / Math.max(1, slots - 1);
  const offset = slots - shown.length;
  shown.forEach((v, i) => {
    if (v === undefined) return;
    const x = (offset + i) * step;
    const y = max > 0 ? height - 1 - (v / max) * (height - 3) : height - 1;
    points.push([x, y]);
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg className={`pt-spark${hot ? ' hot' : ''}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {points.length > 1 && (
        <>
          <polygon className="pt-spark-area" points={`${points[0][0].toFixed(1)},${height} ${line} ${last[0].toFixed(1)},${height}`} />
          <polyline className="pt-spark-line" points={line} />
        </>
      )}
      {last && <circle className="pt-spark-end" cx={last[0]} cy={last[1]} r={1.8} />}
    </svg>
  );
}
