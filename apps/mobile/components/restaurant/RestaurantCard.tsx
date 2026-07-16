import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import type { Restaurant, RestaurantWithDistance } from '../../types';
import { getScoreColor, getScoreBg, isPerfectScore } from '../../utils/scoring';
import TrendCue from '../TrendCue';

interface RestaurantCardProps {
  restaurant: Restaurant | RestaurantWithDistance;
  onPress: () => void;
  onShowOnMap?: () => void;
  /** Show a heart/bookmark toggle */
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

function formatDist(meters: number): string {
  const mi = meters / 1609.34;
  if (mi < 0.1) return '<0.1 mi';
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

export function RestaurantCard({
  restaurant,
  onPress,
  onShowOnMap,
  isFavorite,
  onToggleFavorite,
}: RestaurantCardProps) {
  const dist = 'distanceMeters' in restaurant ? restaurant.distanceMeters : null;
  const s = restaurant.latest_score ?? null;
  const color = getScoreColor(s);

  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.body, pressed && styles.bodyPressed]}
        onPress={onPress}
      >
        {/* Score pill */}
        <View style={[styles.scorePill, { backgroundColor: getScoreBg(s) }]}>
          <View style={styles.scoreNumRow}>
            <Text style={[styles.scoreNum, { color }]}>{s ?? '—'}</Text>
            {isPerfectScore(s) && (
              <Ionicons name="star" size={10} color="#ca8a04" style={{ marginLeft: 1, marginTop: -2 }} />
            )}
          </View>
          {s != null && <Text style={styles.scoreDenom}>/100</Text>}
        </View>

        {/* Info */}
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{restaurant.name}</Text>

          <View style={styles.detailLine}>
            {restaurant.city ? (
              <>
                <Text style={styles.detail}>{restaurant.city}{restaurant.state ? `, ${restaurant.state}` : ''}</Text>
                <Text style={styles.dot}>·</Text>
              </>
            ) : null}
            {restaurant.latest_inspection_date && (
              <Text style={styles.detail}>
                {format(parseISO(restaurant.latest_inspection_date), 'MMM d, yyyy')}
              </Text>
            )}
            {dist !== null && (
              <>
                <Text style={styles.dot}>·</Text>
                <Text style={styles.detail}>{formatDist(dist)}</Text>
              </>
            )}
          </View>

          <View style={styles.subRow}>
            {restaurant.inspection_count > 0 && (
              <Text style={styles.sub}>
                {restaurant.inspection_count} inspection{restaurant.inspection_count !== 1 ? 's' : ''} on record
              </Text>
            )}
            <TrendCue
              scoreHistory={restaurant.score_history}
              scoreTrend={restaurant.score_trend}
              violationHistory={restaurant.violation_history}
              violationTrend={restaurant.violation_trend}
            />
          </View>
        </View>
      </Pressable>

      {/* Action strip */}
      <View style={styles.strip}>
        {onToggleFavorite && (
          <Pressable
            style={({ pressed }) => [styles.action, pressed && styles.actionHit]}
            onPress={onToggleFavorite}
          >
            <Ionicons
              name={isFavorite ? 'heart' : 'heart-outline'}
              size={16}
              color={isFavorite ? '#dc2626' : '#94a3b8'}
            />
          </Pressable>
        )}
        {onShowOnMap && (
          <>
            <View style={styles.stripDivider} />
            <Pressable
              style={({ pressed }) => [styles.action, pressed && styles.actionHit]}
              onPress={onShowOnMap}
            >
              <Ionicons name="navigate-outline" size={14} color="#64748b" />
              <Text style={styles.actionLabel}>Map</Text>
            </Pressable>
          </>
        )}
        <View style={styles.stripDivider} />
        <Pressable
          style={({ pressed }) => [styles.action, styles.actionMain, pressed && styles.actionMainHit]}
          onPress={onPress}
        >
          <Text style={styles.actionMainLabel}>Inspection Report</Text>
          <Ionicons name="arrow-forward" size={13} color="#15803d" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 10,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  body: {
    flexDirection: 'row',
    padding: 14,
    gap: 12,
    alignItems: 'center',
  },
  bodyPressed: {
    backgroundColor: '#f8fafc',
  },
  scorePill: {
    width: 56,
    alignItems: 'center',
    borderRadius: 12,
    paddingTop: 10,
    paddingBottom: 7,
    gap: 4,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  scoreNumRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  scoreNum: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
  },
  scoreDenom: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.3,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  detailLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  detail: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  dot: {
    fontSize: 12,
    color: '#cbd5e1',
    fontWeight: '700',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 1,
  },
  sub: {
    fontSize: 11,
    color: '#94a3b8',
  },
  strip: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    height: 40,
  },
  stripDivider: {
    width: 1,
    backgroundColor: '#f1f5f9',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    gap: 5,
  },
  actionHit: {
    backgroundColor: '#f1f5f9',
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  actionMain: {
    flex: 1,
    gap: 6,
    backgroundColor: '#f0fdf4',
    borderBottomRightRadius: 14,
  },
  actionMainHit: {
    backgroundColor: '#dcfce7',
  },
  actionMainLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#15803d',
    letterSpacing: -0.1,
  },
});
