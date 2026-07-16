import type { ScorePoint, ViolationPoint } from '../types';

type Dir = 'up' | 'down' | 'flat' | null;

const COLORS = { up: '#16a34a', down: '#dc2626', flat: '#94a3b8' };

interface Props {
  scoreHistory?: ScorePoint[];
  scoreTrend?: Dir;
  violationHistory?: ViolationPoint[];
  violationTrend?: Dir;
  width?: number;
  height?: number;
}

// A vertical domain with a minimum 20-point span, so a small change reads as a
// gentle slope rather than a cliff, while real swings still fill the box.
function sparkDomain(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 20);
  const mid = (min + max) / 2;
  return [mid - span / 2, mid + span / 2];
}

/**
 * At-a-glance trend: a mini sparkline (oriented so up = better) plus a
 * direction arrow. Prefers the score trend; falls back to a violation-count
 * trend where scores aren't available over time. Renders nothing without
 * at least two comparable inspections.
 */
export default function TrendCue({
  scoreHistory,
  scoreTrend,
  violationHistory,
  violationTrend,
  width = 52,
  height = 18,
}: Props) {
  let series: number[] | null = null;
  let trend: Dir = null;
  let label = '';

  if (scoreHistory && scoreHistory.length >= 2 && scoreTrend) {
    series = scoreHistory.map((p) => p.score); // higher = better
    trend = scoreTrend;
    label = 'Score trend';
  } else if (violationHistory && violationHistory.length >= 2 && violationTrend) {
    series = violationHistory.map((p) => -p.count); // fewer violations = better
    trend = violationTrend;
    label = 'Violation trend';
  }
  if (!series || !trend) return null;

  const color = COLORS[trend];
  const [lo, hi] = sparkDomain(series);
  const pad = 2;
  const coords = series.map((v, i) => ({
    x: pad + (i / (series!.length - 1)) * (width - 2 * pad),
    y: pad + (1 - (v - lo) / (hi - lo)) * (height - 2 * pad),
  }));
  const points = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '–';
  const dir = trend === 'up' ? 'improving' : trend === 'down' ? 'declining' : 'steady';

  return (
    <span className="trend-cue" title={`${label}: ${dir}`}>
      <svg width={width} height={height} aria-hidden focusable="false">
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 2 : 1} fill={color} />
        ))}
      </svg>
      <span className="trend-arrow" style={{ color }} aria-label={dir}>{arrow}</span>
    </span>
  );
}
