import { useMemo } from 'react';
import { subDays, parseISO } from 'date-fns';
import type { Restaurant, RestaurantWithDistance, FilterState, SortOption } from '../types';

const DEFAULT_FILTERS: FilterState = {
  minScore: 0,
  maxDistance: 50,
  recentOnly: false,
  hideCritical: false,
  violationTypes: [],
};

export { DEFAULT_FILTERS };

export function useFilteredRestaurants(
  restaurants: Restaurant[] | RestaurantWithDistance[] | undefined,
  filters: FilterState,
  sort: SortOption
) {
  const filtered = useMemo(() => {
    if (!restaurants) return [];

    const cutoff = subDays(new Date(), 90);

    return restaurants.filter((r) => {
      // Min score
      if (filters.minScore > 0) {
        if (r.latest_score === null || r.latest_score === undefined || r.latest_score < filters.minScore) return false;
      }

      // Max distance
      const distMeters: number | null = 'distanceMeters' in r ? (r as RestaurantWithDistance).distanceMeters : null;
      if (distMeters !== null && distMeters > filters.maxDistance * 1609.34) return false;

      // Recent only
      if (filters.recentOnly) {
        if (!r.latest_inspection_date) return false;
        if (parseISO(r.latest_inspection_date) < cutoff) return false;
      }

      // Hide critical
      if (filters.hideCritical && r.has_critical_violations) return false;

      // Excluded violation types
      if (filters.violationTypes.length > 0 && r.violation_categories) {
        const hasExcluded = r.violation_categories.some((cat) =>
          filters.violationTypes.includes(cat)
        );
        if (hasExcluded) return false;
      }

      return true;
    });
  }, [restaurants, filters]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sort) {
      case 'score':
        return arr.sort((a, b) => (b.latest_score ?? -1) - (a.latest_score ?? -1));
      case 'distance':
        return arr.sort((a, b) => {
          const da: number = 'distanceMeters' in a ? (a as RestaurantWithDistance).distanceMeters : 0;
          const db: number = 'distanceMeters' in b ? (b as RestaurantWithDistance).distanceMeters : 0;
          return da - db;
        });
      case 'recent':
        return arr.sort((a, b) => {
          const da = a.latest_inspection_date ?? '';
          const db = b.latest_inspection_date ?? '';
          return db.localeCompare(da);
        });
      default:
        return arr;
    }
  }, [filtered, sort]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.minScore > 0) count++;
    if (filters.maxDistance < 50) count++;
    if (filters.recentOnly) count++;
    if (filters.hideCritical) count++;
    count += filters.violationTypes.length;
    return count;
  }, [filters]);

  return { data: sorted, count: sorted.length, activeFilterCount };
}
