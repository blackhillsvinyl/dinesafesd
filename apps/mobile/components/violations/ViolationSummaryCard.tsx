import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SeverityDistributionBar from './SeverityDistributionBar';

interface Violation {
  severity: 'critical' | 'major' | 'minor';
  corrected: boolean;
}

interface Props {
  violations: Violation[];
}

export default function ViolationSummaryCard({ violations }: Props) {
  if (violations.length === 0) {
    return (
      <View style={styles.card}>
        <View style={styles.emptyState}>
          <Ionicons name="checkmark-circle" size={28} color="#22c55e" />
          <Text style={styles.emptyText}>No violations found</Text>
        </View>
      </View>
    );
  }

  const critical = violations.filter((v) => v.severity === 'critical').length;
  const major = violations.filter((v) => v.severity === 'major').length;
  const minor = violations.filter((v) => v.severity === 'minor').length;
  const total = violations.length;
  const corrected = violations.filter((v) => v.corrected).length;
  const correctedPct = total > 0 ? Math.round((corrected / total) * 100) : 0;

  return (
    <View style={styles.card}>
      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{total}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: '#ef4444' }]}>{critical}</Text>
          <Text style={styles.statLabel}>Critical</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: '#22c55e' }]}>{corrected}</Text>
          <Text style={styles.statLabel}>Corrected</Text>
        </View>
      </View>

      {/* Severity distribution bar */}
      <View style={styles.barWrapper}>
        <SeverityDistributionBar critical={critical} major={major} minor={minor} />
      </View>

      {/* Corrected progress bar */}
      <View style={styles.progressSection}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressLabel}>Corrected on-site</Text>
          <Text style={styles.progressValue}>
            {corrected}/{total} ({correctedPct}%)
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${correctedPct}%` as any },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  emptyState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#22c55e',
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 12,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  statLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  barWrapper: {
    marginBottom: 12,
  },
  progressSection: {
    marginTop: 4,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  progressValue: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '500',
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#e5e7eb',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 3,
  },
});
