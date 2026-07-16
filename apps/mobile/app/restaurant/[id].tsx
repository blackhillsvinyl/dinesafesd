import { useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Linking,
  Platform,
  Share,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { useRestaurant } from '../../hooks/useRestaurants';
import { useIsFavorite, useToggleFavorite } from '../../hooks/useFavorites';
import { useIsOnWatchlist, useToggleWatchlist } from '../../hooks/useWatchlist';
import type { Inspection, Violation } from '../../types';
import ScoreTrendChart from '../../components/violations/ScoreTrendChart';
import ViolationSummaryCard from '../../components/violations/ViolationSummaryCard';
import { getScoreColor, isPerfectScore } from '../../utils/scoring';

export default function RestaurantDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: restaurant, isLoading, error } = useRestaurant(id);
  const { data: isFavorite } = useIsFavorite(id);
  const toggleFavorite = useToggleFavorite();
  const { data: isWatchlisted } = useIsOnWatchlist(id);
  const toggleWatchlist = useToggleWatchlist();

  const handleGetDirections = useCallback(() => {
    if (!restaurant) return;

    const address = encodeURIComponent(
      `${restaurant.address}, ${restaurant.city}, ${restaurant.state}`
    );

    const url = Platform.select({
      ios: `maps:?daddr=${address}`,
      android: `geo:0,0?q=${address}`,
      default: `https://maps.google.com/?q=${address}`,
    });

    Linking.openURL(url);
  }, [restaurant]);

  const handleShare = async () => {
    if (!restaurant) return;
    await Share.share({
      message: `Check out ${restaurant.name} on DineSafeSD — Score: ${restaurant.latest_score ?? 'N/A'}\n${restaurant.address}, ${restaurant.city}, ${restaurant.state}`,
      title: restaurant.name,
    });
  };

  const getSeverityColor = (severity: string): string => {
    switch (severity) {
      case 'critical':
        return '#ef4444';
      case 'major':
        return '#f97316';
      default:
        return '#eab308';
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centerContent}>
        <ActivityIndicator size="large" color="#15803d" />
      </View>
    );
  }

  if (error || !restaurant) {
    return (
      <View style={styles.centerContent}>
        <Ionicons name="alert-circle-outline" size={64} color="#ef4444" />
        <Text style={styles.errorText}>Failed to load restaurant</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Colored header band */}
      <View style={[styles.headerBand, { backgroundColor: getScoreColor(restaurant.latest_score ?? null) }]} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.name}>{restaurant.name}</Text>
        <View style={styles.addressRow}>
          <Ionicons name="location-outline" size={16} color="#6b7280" />
          <Text style={styles.address}>
            {restaurant.address}, {restaurant.city}, {restaurant.state}
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable style={styles.actionButton} onPress={handleGetDirections}>
            <Ionicons name="navigate" size={20} color="#15803d" />
            <Text style={styles.actionButtonText}>Directions</Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, isFavorite && styles.actionButtonFavorited]}
            onPress={() =>
              toggleFavorite.mutate({ restaurantId: id, isFavorite: !!isFavorite })
            }
          >
            <Ionicons
              name={isFavorite ? 'heart' : 'heart-outline'}
              size={20}
              color={isFavorite ? '#dc2626' : '#64748b'}
            />
            <Text
              style={[
                styles.actionButtonText,
                { color: isFavorite ? '#dc2626' : '#15803d' },
              ]}
            >
              {isFavorite ? 'Saved' : 'Save'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, isWatchlisted && styles.actionButtonWatchlisted]}
            onPress={() =>
              toggleWatchlist.mutate({ restaurantId: id, isWatchlisted: !!isWatchlisted })
            }
          >
            <Ionicons
              name={isWatchlisted ? 'eye' : 'eye-outline'}
              size={20}
              color={isWatchlisted ? '#7c3aed' : '#64748b'}
            />
            <Text
              style={[
                styles.actionButtonText,
                { color: isWatchlisted ? '#7c3aed' : '#15803d' },
              ]}
            >
              {isWatchlisted ? 'Watching' : 'Watch'}
            </Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={handleShare}>
            <Ionicons name="share-outline" size={20} color="#64748b" />
            <Text style={styles.actionButtonText}>Share</Text>
          </Pressable>
        </View>
      </View>

      {/* Current Score */}
      <View style={styles.scoreSection}>
        <View
          style={[
            styles.scoreBadge,
            { backgroundColor: getScoreColor(restaurant.latest_score ?? null) },
          ]}
        >
          <Text style={styles.scoreNumber}>
            {restaurant.latest_score ?? '?'}
          </Text>
          {isPerfectScore(restaurant.latest_score ?? null) && (
            <Text style={styles.starBadge}>{'\u2605'} Perfect</Text>
          )}
          {!isPerfectScore(restaurant.latest_score ?? null) && (
            <Text style={styles.scoreLabel}>Current Score</Text>
          )}
        </View>
        {restaurant.latest_inspection_date && (
          <Text style={styles.lastInspection}>
            Last inspected{' '}
            {format(parseISO(restaurant.latest_inspection_date), 'MMMM d, yyyy')}
          </Text>
        )}
        {restaurant.average_score && (
          <Text style={styles.avgScore}>
            Average score: {restaurant.average_score.toFixed(1)}
          </Text>
        )}
      </View>

      {/* Score Trend Chart */}
      {(restaurant.inspections?.filter((i: Inspection) => i.score !== null && i.score !== undefined).length ?? 0) >= 2 && (
        <View style={styles.trendSection}>
          <ScoreTrendChart inspections={restaurant.inspections ?? []} />
        </View>
      )}

      {/* Inspection History */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Inspection History</Text>
        {restaurant.inspections?.length === 0 ? (
          <Text style={styles.noData}>No inspections on record</Text>
        ) : (
          restaurant.inspections?.map((inspection: Inspection) => (
            <InspectionItem
              key={inspection.date}
              inspection={inspection}
              getScoreColor={getScoreColor}
              getSeverityColor={getSeverityColor}
            />
          ))
        )}
      </View>

      {/* Data Source */}
      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          Data provided by state and local health departments. Inspections are a
          snapshot in time and violations may have been corrected on-site.
        </Text>
      </View>
    </ScrollView>
  );
}

function InspectionItem({
  inspection,
  getScoreColor,
  getSeverityColor,
}: {
  inspection: Inspection;
  getScoreColor: (score: number | null) => string;
  getSeverityColor: (severity: string) => string;
}) {
  return (
    <View style={itemStyles.container}>
      <View style={itemStyles.header}>
        <View style={itemStyles.dateRow}>
          <Ionicons name="calendar-outline" size={16} color="#6b7280" />
          <Text style={itemStyles.date}>
            {format(parseISO(inspection.date), 'MMMM d, yyyy')}
          </Text>
        </View>
        <View
          style={[
            itemStyles.scoreBadge,
            { backgroundColor: getScoreColor(inspection.score ?? null) },
          ]}
        >
          <Text style={itemStyles.score}>{inspection.score ?? '?'}</Text>
        </View>
      </View>

      {inspection.inspection_type && (
        <Text style={itemStyles.type}>{inspection.inspection_type}</Text>
      )}

      {/* Violation Summary Card */}
      <ViolationSummaryCard violations={inspection.violations ?? []} />

      {/* Violations List */}
      {inspection.violations && inspection.violations.length > 0 && (
        <View style={itemStyles.violationsList}>
          {inspection.violations.map((violation: Violation) => (
            <View key={violation.code} style={itemStyles.violationItem}>
              <View
                style={[
                  itemStyles.severityIndicator,
                  { backgroundColor: getSeverityColor(violation.severity) },
                ]}
              />
              <View style={itemStyles.violationContent}>
                <Text style={itemStyles.violationCode}>{violation.code}</Text>
                <Text style={itemStyles.violationDesc}>
                  {violation.description}
                </Text>
                {violation.corrected && (
                  <View style={itemStyles.correctedBadge}>
                    <Ionicons
                      name="checkmark-circle"
                      size={12}
                      color="#15803d"
                    />
                    <Text style={itemStyles.correctedText}>
                      Corrected on-site
                    </Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafaf9',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fafaf9',
  },
  errorText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6b7280',
    fontWeight: '500',
  },
  headerBand: {
    height: 6,
  },
  header: {
    backgroundColor: '#fff',
    padding: 20,
    paddingBottom: 18,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  name: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.6,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 5,
  },
  address: {
    fontSize: 14,
    color: '#64748b',
    flex: 1,
    fontWeight: '400',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dcfce7',
  },
  actionButtonFavorited: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  actionButtonWatchlisted: {
    backgroundColor: '#f5f3ff',
    borderColor: '#ddd6fe',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#15803d',
  },
  scoreSection: {
    backgroundColor: '#fff',
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginTop: 12,
    marginHorizontal: 14,
    borderRadius: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  scoreBadge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  scoreNumber: {
    fontSize: 44,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
  },
  scoreLabel: {
    fontSize: 11,
    color: '#fff',
    opacity: 0.9,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  starBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fef08a',
    letterSpacing: 0.5,
  },
  lastInspection: {
    marginTop: 14,
    fontSize: 14,
    color: '#64748b',
    fontWeight: '400',
  },
  avgScore: {
    marginTop: 4,
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  trendSection: {
    backgroundColor: '#fff',
    marginTop: 14,
    marginHorizontal: 14,
    padding: 18,
    borderRadius: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  section: {
    backgroundColor: '#fff',
    marginTop: 14,
    marginHorizontal: 14,
    padding: 18,
    borderRadius: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 16,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  noData: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 24,
    fontWeight: '400',
  },
  disclaimer: {
    padding: 20,
    marginBottom: 32,
  },
  disclaimerText: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 17,
    fontWeight: '400',
  },
});

const itemStyles = StyleSheet.create({
  container: {
    backgroundColor: '#fafaf9',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  date: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  scoreBadge: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  score: {
    fontSize: 17,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  type: {
    marginTop: 6,
    fontSize: 12,
    color: '#94a3b8',
    textTransform: 'uppercase',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  violationsList: {
    marginTop: 14,
    gap: 10,
  },
  violationItem: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
  },
  severityIndicator: {
    width: 4,
    borderRadius: 2,
  },
  violationContent: {
    flex: 1,
  },
  violationCode: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.3,
  },
  violationDesc: {
    fontSize: 13,
    color: '#374151',
    marginTop: 3,
    lineHeight: 18,
    fontWeight: '400',
  },
  correctedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  correctedText: {
    fontSize: 11,
    color: '#15803d',
    fontWeight: '600',
  },
  comments: {
    marginTop: 14,
    padding: 14,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  commentsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 6,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  commentsText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
    fontWeight: '400',
  },
});
