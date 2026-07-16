import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { Restaurant } from '../../types';
import {
  getScoreColor,
  getScoreBg,
  isPerfectScore,
} from '../../utils/scoring';

interface FeedCardProps {
  restaurant: Restaurant;
  /** Extra metadata line (e.g. "3 critical violations") */
  meta?: string;
  /** Accent color for left border */
  accent?: string;
  /** Show a heart toggle */
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

function daysAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff === 0) return 'Today';
  if (diff === 1) return '1 day ago';
  return `${diff} days ago`;
}

export function FeedCard({
  restaurant,
  meta,
  accent,
  isFavorite,
  onToggleFavorite,
}: FeedCardProps) {
  const s = restaurant.latest_score ?? null;
  const color = getScoreColor(s);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        accent ? { borderLeftWidth: 3, borderLeftColor: accent } : undefined,
        pressed && styles.cardPressed,
      ]}
      onPress={() => router.push(`/restaurant/${restaurant.id}`)}
    >
      {/* Score pill */}
      <View style={[styles.scorePill, { backgroundColor: getScoreBg(s) }]}>
        <View style={styles.scoreNumRow}>
          <Text style={[styles.scoreNum, { color }]}>{s ?? '—'}</Text>
          {isPerfectScore(s) && (
            <Ionicons
              name="star"
              size={9}
              color="#ca8a04"
              style={{ marginLeft: 1, marginTop: -1 }}
            />
          )}
        </View>
        {s != null && <Text style={styles.scoreDenom}>/100</Text>}
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {restaurant.name}
        </Text>
        <View style={styles.detailLine}>
          {restaurant.city ? (
            <Text style={styles.detail}>
              {restaurant.city}
              {restaurant.state ? `, ${restaurant.state}` : ''}
            </Text>
          ) : null}
          {restaurant.latest_inspection_date ? (
            <>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.detail}>
                {daysAgo(restaurant.latest_inspection_date)}
              </Text>
            </>
          ) : null}
        </View>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>

      {/* Favorite toggle */}
      {onToggleFavorite && (
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            onToggleFavorite();
          }}
          hitSlop={8}
          style={styles.heartBtn}
        >
          <Ionicons
            name={isFavorite ? 'heart' : 'heart-outline'}
            size={20}
            color={isFavorite ? '#dc2626' : '#cbd5e1'}
          />
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    gap: 10,
    marginBottom: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardPressed: {
    backgroundColor: '#f8fafc',
  },
  scorePill: {
    width: 48,
    alignItems: 'center',
    borderRadius: 10,
    paddingTop: 8,
    paddingBottom: 5,
    gap: 3,
  },
  scoreNumRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  scoreNum: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  scoreDenom: {
    fontSize: 8,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.3,
  },
  info: {
    flex: 1,
    gap: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  detailLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  detail: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
  dot: {
    fontSize: 11,
    color: '#cbd5e1',
    fontWeight: '700',
  },
  meta: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
    marginTop: 1,
  },
  heartBtn: {
    padding: 4,
  },
});
