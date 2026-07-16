import { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  TextInput,
  Text,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSearchRestaurants } from '../../hooks/useRestaurants';
import { RestaurantCard } from '../../components/restaurant/RestaurantCard';
import type { Restaurant } from '../../types';

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const { data: results, isLoading } = useSearchRestaurants(debouncedQuery);

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    // Simple debounce
    const timeoutId = setTimeout(() => {
      setDebouncedQuery(text);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, []);

  const handleClear = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Restaurant }) => (
      <RestaurantCard
        restaurant={item}
        onPress={() => router.push(`/restaurant/${item.id}`)}
      />
    ),
    []
  );

  return (
    <View style={styles.container}>
      {/* Search Input */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputContainer}>
          <Ionicons
            name="search"
            size={20}
            color="#9ca3af"
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search restaurants..."
            placeholderTextColor="#9ca3af"
            value={query}
            onChangeText={handleSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={handleClear} style={styles.clearButton}>
              <Ionicons name="close-circle" size={20} color="#9ca3af" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Results */}
      <View style={styles.resultsContainer}>
        {isLoading ? (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color="#22c55e" />
          </View>
        ) : debouncedQuery.length === 0 ? (
          <View style={styles.centerContent}>
            <Ionicons name="restaurant-outline" size={64} color="#d1d5db" />
            <Text style={styles.emptyText}>
              Search for restaurants by name or address
            </Text>
          </View>
        ) : results?.length === 0 ? (
          <View style={styles.centerContent}>
            <Ionicons name="search-outline" size={64} color="#d1d5db" />
            <Text style={styles.emptyText}>No restaurants found</Text>
            <Text style={styles.emptySubtext}>Try a different search term</Text>
          </View>
        ) : (
          <FlashList
            data={results}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  searchContainer: {
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 16,
    color: '#374151',
  },
  clearButton: {
    padding: 4,
  },
  resultsContainer: {
    flex: 1,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 4,
  },
  listContent: {
    padding: 16,
  },
});
