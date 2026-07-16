import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

interface Props {
  critical: number;
  major: number;
  minor: number;
}

const BAR_WIDTH = 280;
const BAR_HEIGHT = 24;
const BAR_RADIUS = 6;

export default function SeverityDistributionBar({ critical, major, minor }: Props) {
  const total = critical + major + minor;

  if (total === 0) return null;

  const criticalWidth = (critical / total) * BAR_WIDTH;
  const majorWidth = (major / total) * BAR_WIDTH;
  const minorWidth = (minor / total) * BAR_WIDTH;

  return (
    <View style={styles.container}>
      <Svg width={BAR_WIDTH} height={BAR_HEIGHT}>
        {/* Base: minor (yellow) fills full width with border radius */}
        <Rect
          x={0}
          y={0}
          width={BAR_WIDTH}
          height={BAR_HEIGHT}
          rx={BAR_RADIUS}
          ry={BAR_RADIUS}
          fill="#eab308"
        />
        {/* Major (orange) layered on top, left-aligned */}
        {majorWidth + criticalWidth > 0 && (
          <Rect
            x={0}
            y={0}
            width={criticalWidth + majorWidth}
            height={BAR_HEIGHT}
            rx={BAR_RADIUS}
            ry={BAR_RADIUS}
            fill="#f97316"
          />
        )}
        {/* Critical (red) layered on top, left-aligned */}
        {criticalWidth > 0 && (
          <Rect
            x={0}
            y={0}
            width={criticalWidth}
            height={BAR_HEIGHT}
            rx={BAR_RADIUS}
            ry={BAR_RADIUS}
            fill="#ef4444"
          />
        )}
      </Svg>
      <View style={styles.legend}>
        {critical > 0 && (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} />
            <Text style={styles.legendText}>{critical} critical</Text>
          </View>
        )}
        {major > 0 && (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#f97316' }]} />
            <Text style={styles.legendText}>{major} major</Text>
          </View>
        )}
        {minor > 0 && (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#eab308' }]} />
            <Text style={styles.legendText}>{minor} minor</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
    color: '#374151',
  },
});
