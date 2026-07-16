import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import { format, parseISO } from 'date-fns';
import { getMarkerColor } from '../../utils/scoring';

interface Inspection {
  date: string;
  score?: number | null;
}

interface Props {
  inspections: Inspection[];
}

const CHART_WIDTH = 280;
const CHART_HEIGHT = 120;
const PADDING = { top: 16, right: 16, bottom: 24, left: 32 };

const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

export default function ScoreTrendChart({ inspections }: Props) {
  const scored = inspections
    .filter((i) => i.score !== null && i.score !== undefined)
    .sort(
      (a, b) =>
        new Date(a.date).getTime() -
        new Date(b.date).getTime()
    ) as (Inspection & { score: number })[];

  if (scored.length < 2) return null;

  const minScore = Math.min(...scored.map((i) => i.score));
  const maxScore = Math.max(...scored.map((i) => i.score));
  // Pad the score range slightly so points aren't at the very edge
  const scoreMin = Math.max(0, Math.floor(minScore / 10) * 10 - 10);
  const scoreMax = Math.min(100, Math.ceil(maxScore / 10) * 10 + 10);
  const scoreRange = scoreMax - scoreMin || 1;

  const toX = (index: number) =>
    PADDING.left + (index / (scored.length - 1)) * plotWidth;

  const toY = (score: number) =>
    PADDING.top + plotHeight - ((score - scoreMin) / scoreRange) * plotHeight;

  const points = scored.map((item, i) => ({
    x: toX(i),
    y: toY(item.score),
    score: item.score,
    date: item.date,
  }));

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');

  // Y-axis labels: scoreMin, mid, scoreMax
  const yLabels = [scoreMax, Math.round((scoreMin + scoreMax) / 2), scoreMin];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Score Trend</Text>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
        {/* Y-axis labels */}
        {yLabels.map((label) => (
          <SvgText
            key={label}
            x={PADDING.left - 4}
            y={toY(label) + 4}
            fontSize={9}
            fill="#9ca3af"
            textAnchor="end"
          >
            {label}
          </SvgText>
        ))}

        {/* Trend line */}
        <Polyline
          points={polylinePoints}
          fill="none"
          stroke="#d1d5db"
          strokeWidth={2}
        />

        {/* Data points */}
        {points.map((p, i) => (
          <Circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={5}
            fill={getMarkerColor(p.score)}
            stroke="#fff"
            strokeWidth={1.5}
          />
        ))}

        {/* X-axis: first and last date labels */}
        <SvgText
          x={points[0].x}
          y={CHART_HEIGHT - 4}
          fontSize={9}
          fill="#9ca3af"
          textAnchor="start"
        >
          {format(parseISO(scored[0].date), 'MM/yy')}
        </SvgText>
        <SvgText
          x={points[points.length - 1].x}
          y={CHART_HEIGHT - 4}
          fontSize={9}
          fill="#9ca3af"
          textAnchor="end"
        >
          {format(parseISO(scored[scored.length - 1].date), 'MM/yy')}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
  },
});
