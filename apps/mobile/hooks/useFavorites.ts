import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchIndex } from '../lib/api';
import { getFavorites, addFavorite, removeFavorite, isFavorite as checkIsFavorite } from '../lib/favorites';
import type { Restaurant } from '../types';

export function useFavorites() {
  return useQuery({
    queryKey: ['favorites'],
    queryFn: async (): Promise<Restaurant[]> => {
      const ids = new Set(await getFavorites());
      if (ids.size === 0) return [];
      const index = await fetchIndex();
      return index.restaurants
        .filter((r) => ids.has(r.id))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: 1000 * 60 * 2,
  });
}

export function useIsFavorite(restaurantId: string) {
  return useQuery({
    queryKey: ['favorite', restaurantId],
    queryFn: () => checkIsFavorite(restaurantId),
    enabled: !!restaurantId,
  });
}

export function useToggleFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ restaurantId, isFavorite }: { restaurantId: string; isFavorite: boolean }) => {
      if (isFavorite) await removeFavorite(restaurantId);
      else await addFavorite(restaurantId);
    },
    onSuccess: (_, { restaurantId }) => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      queryClient.invalidateQueries({ queryKey: ['favorite', restaurantId] });
    },
  });
}
