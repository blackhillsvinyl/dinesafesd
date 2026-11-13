import type { ScorePoint, ViolationPoint } from '../types';

interface Props {
  scoreHistory?: ScorePoint[];
  violationHistory?: ViolationPoint[];
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

export interface TrendSummary {
  /** Values to draw, oldest first, oriented so up = better. */
  series: number[];
  /** Short visible text: the size of the change, not a verdict. */
  text: string;
  arrow: '▲' | '▼' | '';
  /** Full sentence for screen readers and the hover title. */
  sentence: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What changed between the two most recent inspections, stated as a number.
 * A drop from 100 to 98 and a drop from 90 to 70 are both "down"; showing
 * the size (and no alarm color) lets the reader tell them apart. Prefers
 * scores; falls back to violation counts where scores aren't available over
 * time. Null without two comparable inspections.
 */
export function trendSummary(
  scoreHistory?: ScorePoint[],
  violationHistory?: ViolationPoint[]
): TrendSummary | null {
  if (scoreHistory && scoreHistory.length >= 2) {
    const prev = scoreHistory[scoreHistory.length - 2].score;
    const last = scoreHistory[scoreHistory.length - 1].score;
    const d = last - prev;
    const size = plural(Math.abs(d), 'point');
    return {
      series: scoreHistory.map((p) => p.score),
      arrow: d > 0 ? '▲' : d < 0 ? '▼' : '',
      text: d === 0 ? 'No change' : `${Math.abs(d)} ${Math.abs(d) === 1 ? 'pt' : 'pts'}`,
      sentence:
        d === 0
          ? `Score unchanged from the previous inspection, at ${last}.`
          : `Score ${d > 0 ? 'up' : 'down'} ${size} from the previous inspection, ${prev} to ${last}.`,
    };
  }
  if (violationHistory && violationHistory.length >= 2) {
    const prev = violationHistory[violationHistory.length - 2].count;
    const last = violationHistory[violationHistory.length - 1].count;
    const d = last - prev;
    return {
      series: violationHistory.map((p) => -p.count), // fewer violations = better
      arrow: '',
      text: d === 0 ? 'Same count' : `${d > 0 ? '+' : '−'}${plural(Math.abs(d), 'violation')}`,
      sentence:
        d === 0
          ? `Same number of violations as the previous inspection, ${last}.`
          : `${plural(Math.abs(d), d > 0 ? 'more violation' : 'fewer violation')} than the previous inspection, ${prev} to ${last}.`,
    };
  }
  return null;
}

/**
 * At-a-glance history: a mini sparkline plus the size of the latest change.
 * Drawn in neutral ink on purpose — the app reports the change and leaves
 * the judgment to the reader, and the score itself is right beside it.
 */
export default function TrendCue({ scoreHistory, violationHistory, width = 52, height = 18 }: Props) {
  const t = trendSummary(scoreHistory, violationHistory);
  if (!t) return null;

  const [lo, hi] = sparkDomain(t.series);
  const pad = 2;
  const coords = t.series.map((v, i) => ({
    x: pad + (i / (t.series.length - 1)) * (width - 2 * pad),
    y: pad + (1 - (v - lo) / (hi - lo)) * (height - 2 * pad),
  }));
  const points = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  return (
    <span className="trend-cue" title={t.sentence}>
      <svg width={width} height={height} aria-hidden="true" focusable="false">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 2 : 1} fill="currentColor" />
        ))}
      </svg>
      <span className="trend-delta" aria-hidden="true">
        {t.arrow && <span className="trend-arrow">{t.arrow}</span>}
        {t.text}
      </span>
      <span className="sr-only">{t.sentence}</span>
    </span>
  );
}
