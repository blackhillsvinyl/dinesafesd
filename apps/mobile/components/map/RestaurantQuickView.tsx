import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { parseISO } from 'date-fns';
import { getUniqueCategories } from '../../lib/violationCategories';
import type { ViolationCategory } from '../../lib/violationCategories';
import { getScoreColor as scoreColor, getScoreBg as scoreBg, isPerfectScore } from '../../utils/scoring';
import TrendCue from '../TrendCue';
import type { ScorePoint, ViolationPoint } from '../../types';

interface Violation {
  description: string;
  severity: 'critical' | 'major' | 'minor';
  corrected: boolean;
}

interface Props {
  name: string;
  address: string;
  city: string;
  score: number | null;
  inspectionDate: string | null;
  scoreHistory: ScorePoint[];
  scoreTrend: 'up' | 'down' | 'flat' | null;
  violationHistory: ViolationPoint[];
  violationTrend: 'up' | 'down' | 'flat' | null;
  violations: Violation[] | null;
  isLoading: boolean;
  onViewDetails: () => void;
  onClose: () => void;
}

export default function RestaurantQuickView({
  name, address, city, score, inspectionDate, scoreHistory, scoreTrend,
  violationHistory, violationTrend,
  violations, isLoading, onViewDetails, onClose,
}: Props) {
  const categories = violations
    ? getUniqueCategories(violations.map((v) => v.description))
    : [];
  const criticalCount = violations?.filter((v) => v.severity === 'critical').length ?? 0;
  const color = scoreColor(score);

  return (
    <View style={styles.card}>
      {/* Close */}
      <Pressable style={styles.close} onPress={onClose} hitSlop={14}>
        <Ionicons name="close" size={16} color="#94a3b8" />
      </Pressable>

      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.scorePill, { backgroundColor: scoreBg(score) }]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' }}>
            <Text style={[styles.scoreNum, { color }]}>{score ?? '—'}</Text>
            {isPerfectScore(score) && (
              <Text style={{ fontSize: 9, color: '#ca8a04', marginLeft: 1, marginTop: -1 }}>{'\u2605'}</Text>
            )}
          </View>
          {score != null && <Text style={styles.scoreDenom}>/100</Text>}
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.addr} numberOfLines={1}>
            {address}{city ? `, ${city}` : ''}
          </Text>
          <View style={styles.metaRow}>
            {inspectionDate && (
              <Text style={styles.date}>
                Inspected {parseISO(inspectionDate).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                })}
              </Text>
            )}
            <TrendCue
              scoreHistory={scoreHistory}
              scoreTrend={scoreTrend}
              violationHistory={violationHistory}
              violationTrend={violationTrend}
            />
          </View>
        </View>
      </View>

      {/* Violations */}
      {isLoading ? (
        <View style={styles.loadRow}>
          <ActivityIndicator size="small" color="#64748b" />
          <Text style={styles.loadText}>Loading violations…</Text>
        </View>
      ) : categories.length > 0 ? (
        <View style={styles.viols}>
          <Text style={styles.violsLabel}>Violations found:</Text>
          <View style={styles.chips}>
            {categories.slice(0, 5).map((cat: ViolationCategory) => (
              <View key={cat.key} style={[styles.chip, { borderColor: cat.color + '40' }]}>
                <Ionicons name={cat.icon} size={12} color={cat.color} />
                <Text style={[styles.chipLabel, { color: cat.color }]}>{cat.label}</Text>
              </View>
            ))}
            {categories.length > 5 && (
              <Text style={styles.more}>+{categories.length - 5}</Text>
            )}
          </View>
          {criticalCount > 0 && (
            <View style={styles.critBar}>
              <Ionicons name="alert-circle" size={13} color="#b91c1c" />
              <Text style={styles.critText}>
                {criticalCount} critical{criticalCount > 1 ? '' : ''} found
              </Text>
            </View>
          )}
        </View>
      ) : violations && violations.length === 0 ? (
        <View style={styles.cleanBar}>
          <Ionicons name="shield-checkmark" size={14} color="#15803d" />
          <Text style={styles.cleanText}>Clean inspection — no violations</Text>
        </View>
      ) : null}

      {/* CTA */}
      <Pressable
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        onPress={onViewDetails}
      >
        <Text style={styles.ctaText}>View Full Report</Text>
        <Ionicons name="arrow-forward" size={14} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 18,
    padding: 16,
    gap: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  close: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 1,
    backgroundColor: 'rgba(241,245,249,0.8)',
    borderRadius: 12,
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingRight: 28,
  },
  scorePill: {
    width: 56,
    alignItems: 'center',
    borderRadius: 12,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 3,
  },
  scoreNum: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
  },
  scoreDenom: {
    fontSize: 8,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.3,
  },
  headerInfo: {
    flex: 1,
    gap: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  addr: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '400',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 1,
  },
  date: {
    fontSize: 11,
    color: '#94a3b8',
  },
  viols: {
    gap: 6,
  },
  violsLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#94a3b8',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  chipLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  more: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    alignSelf: 'center',
  },
  critBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fef2f2',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  critText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#b91c1c',
  },
  cleanBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f0fdf4',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  cleanText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#15803d',
  },
  loadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#15803d',
    borderRadius: 10,
    paddingVertical: 10,
    gap: 6,
  },
  ctaPressed: {
    backgroundColor: '#166534',
  },
  ctaText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.2,
  },
});
