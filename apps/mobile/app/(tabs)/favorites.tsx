import { useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFavorites, useToggleFavorite } from '../../hooks/useFavorites';
import { useWatchlist, useToggleWatchlist } from '../../hooks/useWatchlist';
import { FeedCard } from '../../components/feed/FeedCard';
import type { Restaurant } from '../../types';

export default function FavoritesScreen() {
  const insets = useSafeAreaInsets();
  const { data: favorites, isLoading: favLoading } = useFavorites();
  const { data: watchlist, isLoading: watchLoading } = useWatchlist();
  const toggleFavorite = useToggleFavorite();
  const toggleWatchlist = useToggleWatchlist();

  const handleToggleFavorite = useCallback(
    (id: string) => {
      toggleFavorite.mutate({ restaurantId: id, isFavorite: true });
    },
    [toggleFavorite]
  );

  const handleToggleWatchlist = useCallback(
    (id: string) => {
      toggleWatchlist.mutate({ restaurantId: id, isWatchlisted: true });
    },
    [toggleWatchlist]
  );

  const isLoading = favLoading || watchLoading;
  const hasAny = (favorites && favorites.length > 0) || (watchlist && watchlist.length > 0);

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#15803d" />
        </View>
      </View>
    );
  }

  if (!hasAny) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Saved</Text>
        </View>
        <View style={styles.centerContent}>
          <Ionicons name="heart-outline" size={64} color="#d1d5db" />
          <Text style={styles.emptyText}>Nothing saved yet</Text>
          <Text style={styles.emptySubtext}>
            Tap the heart to save favorites, or the eye to add to your watchlist
          </Text>
          <Pressable
            style={styles.exploreButton}
            onPress={() => router.push('/(tabs)/discover')}
          >
            <Text style={styles.exploreButtonText}>Explore Restaurants</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.scrollContent}
    >
      {/* Header */}
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Saved</Text>
      </View>

      {/* Favorites section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="heart" size={16} color="#dc2626" />
          <Text style={styles.sectionTitle}>Favorites</Text>
          {favorites && favorites.length > 0 && (
            <Text style={styles.sectionCount}>{favorites.length}</Text>
          )}
        </View>

        {!favorites || favorites.length === 0 ? (
          <Text style={styles.emptySection}>No favorites yet — tap the heart on any restaurant</Text>
        ) : (
          favorites.map((item: Restaurant) => {
            const hasWarning =
              item.latest_score !== undefined &&
              item.latest_score !== null &&
              item.latest_score < 88;
            return (
              <FeedCard
                key={item.id}
                restaurant={item}
                isFavorite
                onToggleFavorite={() => handleToggleFavorite(item.id)}
                meta={hasWarning ? '⚠ Score below 88' : undefined}
                accent={hasWarning ? '#ea580c' : undefined}
              />
            );
          })
        )}
      </View>

      {/* Watchlist section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="eye" size={16} color="#7c3aed" />
          <Text style={[styles.sectionTitle, { color: '#7c3aed' }]}>Watchlist</Text>
          {watchlist && watchlist.length > 0 && (
            <Text style={[styles.sectionCount, { color: '#7c3aed' }]}>{watchlist.length}</Text>
          )}
        </View>

        {!watchlist || watchlist.length === 0 ? (
          <Text style={styles.emptySection}>No restaurants on your watchlist yet — tap the eye icon to follow one</Text>
        ) : (
          watchlist.map((item: Restaurant) => (
            <FeedCard
              key={item.id}
              restaurant={item}
              meta="On watchlist"
              accent="#7c3aed"
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafaf9',
  },
  scrollContent: {
    paddingBottom: 32,
  },
  pageHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.8,
  },
  section: {
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#dc2626',
    letterSpacing: 0.3,
    flex: 1,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
    backgroundColor: '#fef2f2',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
    textAlign: 'center',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 260,
    lineHeight: 20,
  },
  emptySection: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '400',
    paddingVertical: 12,
    lineHeight: 18,
  },
  exploreButton: {
    marginTop: 24,
    backgroundColor: '#0f172a',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  exploreButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
