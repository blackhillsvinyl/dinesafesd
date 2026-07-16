import { useQuery } from '@tanstack/react-query';
import { fetchIndex, fetchRestaurant, distanceMeters } from '../lib/api';
import type { Restaurant, RestaurantDetail, RestaurantWithDistance, Violation } from '../types';

/**
 * All list/map/discover/search data derives from one static index file
 * (~2,600 SD restaurants, a few hundred KB) fetched once and cached.
 */
export function useRestaurantIndex() {
  return useQuery({
    queryKey: ['restaurant-index'],
    queryFn: fetchIndex,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
  });
}

function useIndexDerived<T>(derive: (restaurants: Restaurant[]) => T) {
  const { data: index, isLoading, error } = useRestaurantIndex();
  return {
    data: index ? derive(index.restaurants) : undefined,
    isLoading,
    error,
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

export function useRestaurantsNearby(latitude: number, longitude: number, radiusMiles: number = 10) {
  const enabled = latitude !== 0 && longitude !== 0;
  const { data: index, isLoading, error } = useRestaurantIndex();
  const radiusMeters = radiusMiles * 1609.34;
  const data: RestaurantWithDistance[] | undefined =
    enabled && index
      ? index.restaurants
          .map((r) => ({
            ...r,
            distanceMeters: distanceMeters(latitude, longitude, r.latitude, r.longitude),
          }))
          .filter((r) => r.distanceMeters <= radiusMeters)
          .sort((a, b) => a.distanceMeters - b.distanceMeters)
          .slice(0, 500)
      : undefined;
  return { data, isLoading: enabled && isLoading, error };
}

export function useSearchRestaurants(query: string) {
  const q = query.trim().toLowerCase();
  return useIndexDerived((restaurants) => {
    if (q.length < 2) return [] as Restaurant[];
    return restaurants
      .filter((r) => r.name.toLowerCase().includes(q))
      .sort((a, b) => (b.latest_score ?? -1) - (a.latest_score ?? -1))
      .slice(0, 50);
  });
}

export function useRestaurant(id: string) {
  return useQuery({
    queryKey: ['restaurant', id],
    queryFn: (): Promise<RestaurantDetail> => fetchRestaurant(id),
    enabled: !!id,
    staleTime: 1000 * 60 * 30,
  });
}

/** Violations from the most recent inspection (used by the map quick view). */
export function useLatestViolations(restaurantId: string | null) {
  const { data, isLoading, error } = useRestaurant(restaurantId ?? '');
  const violations: Violation[] | undefined = restaurantId
    ? data
      ? (data.inspections[0]?.violations ?? [])
      : undefined
    : [];
  return { data: violations, isLoading: !!restaurantId && isLoading, error };
}

export function useCodeRedRestaurants() {
  return useIndexDerived((restaurants) => {
    const cutoff = daysAgo(90);
    return restaurants
      .filter((r) => r.has_critical_violations && (r.latest_inspection_date ?? '') >= cutoff)
      .sort((a, b) => (b.latest_inspection_date ?? '').localeCompare(a.latest_inspection_date ?? ''))
      .slice(0, 10);
  });
}

export function useSpotlightRestaurants() {
  return useIndexDerived((restaurants) => {
    const cutoff = daysAgo(180);
    return restaurants
      .filter((r) => (r.latest_score ?? 0) >= 98 && (r.latest_inspection_date ?? '') >= cutoff)
      .sort((a, b) => (b.latest_score ?? -1) - (a.latest_score ?? -1))
      .slice(0, 10);
  });
}

export function useRecentInspections() {
  return useIndexDerived((restaurants) =>
    restaurants
      .filter((r) => r.latest_inspection_date !== null)
      .sort((a, b) => (b.latest_inspection_date ?? '').localeCompare(a.latest_inspection_date ?? ''))
      .slice(0, 15)
  );
}

export function useWatchListRestaurants() {
  return useIndexDerived((restaurants) => {
    const cutoff = daysAgo(180);
    return restaurants
      .filter(
        (r) =>
          r.latest_score !== null && r.latest_score < 85 && (r.latest_inspection_date ?? '') >= cutoff
      )
      .sort((a, b) => (a.latest_score ?? 101) - (b.latest_score ?? 101))
      .slice(0, 10);
  });
}

function byCategory(category: string) {
  return (restaurants: Restaurant[]) =>
    restaurants
      .filter((r) => r.violation_categories.includes(category))
      .sort((a, b) => (b.latest_inspection_date ?? '').localeCompare(a.latest_inspection_date ?? ''))
      .slice(0, 10);
}

export function usePestAlerts() {
  return useIndexDerived(byCategory('pests'));
}

export function useTemperatureViolations() {
  return useIndexDerived(byCategory('temperature'));
}

export function useHandwashingIssues() {
  return useIndexDerived(byCategory('handwashing'));
}

export function usePerfectRecord() {
  return useIndexDerived((restaurants) =>
    restaurants
      .filter((r) => r.latest_score === 100 && !r.has_critical_violations)
      .sort((a, b) => (b.latest_inspection_date ?? '').localeCompare(a.latest_inspection_date ?? ''))
      .slice(0, 10)
  );
}

export function useMostInspected() {
  return useIndexDerived((restaurants) =>
    restaurants
      .filter((r) => r.inspection_count >= 2)
      .sort((a, b) => b.inspection_count - a.inspection_count)
      .slice(0, 10)
  );
}
