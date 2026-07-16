import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
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

// Minimum 20-point vertical span so small changes read as gentle slopes.
function sparkDomain(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 20);
  const mid = (min + max) / 2;
  return [mid - span / 2, mid + span / 2];
}

/**
 * Score trend sparkline + arrow (up = better). Falls back to a violation-count
 * trend where scores aren't available over time. Renders nothing without at
 * least two comparable inspections.
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

  if (scoreHistory && scoreHistory.length >= 2 && scoreTrend) {
    series = scoreHistory.map((p) => p.score);
    trend = scoreTrend;
  } else if (violationHistory && violationHistory.length >= 2 && violationTrend) {
    series = violationHistory.map((p) => -p.count); // fewer = better
    trend = violationTrend;
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

  return (
    <View style={styles.row}>
      <Svg width={width} height={height}>
        <Polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((c, i) => (
          <Circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 2 : 1} fill={color} />
        ))}
      </Svg>
      <Text style={[styles.arrow, { color }]}>{arrow}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  arrow: { fontSize: 11, fontWeight: '700' },
});
