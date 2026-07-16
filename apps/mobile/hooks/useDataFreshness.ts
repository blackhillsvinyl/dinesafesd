import { useRestaurantIndex } from './useRestaurants';

/**
 * Timestamp of the last data publish — powers the "Data updated X ago"
 * line on the About screen.
 */
export function useDataFreshness() {
  const { data: index, isLoading, error } = useRestaurantIndex();
  return {
    data: index ? new Date(index.updated_at) : undefined,
    isLoading,
    error,
  };
}
