import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { fetchIndex } from '../lib/api';
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  isOnWatchlist as checkIsOnWatchlist,
} from "../lib/watchlist";
import type { Restaurant } from '../types';

export function useWatchlist() {
  return useQuery({
    queryKey: ['watchlist'],
    queryFn: async (): Promise<Restaurant[]> => {
      const ids = new Set(await getWatchlist());
      if (ids.size === 0) return [];
      const index = await fetchIndex();
      return index.restaurants
        .filter((r) => ids.has(r.id))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: 1000 * 60 * 2,
  });
}

export function useIsOnWatchlist(restaurantId: string) {
  return useQuery({
    queryKey: ["watchlist", restaurantId],
    queryFn: () => checkIsOnWatchlist(restaurantId),
    enabled: !!restaurantId,
  });
}

export function useToggleWatchlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      restaurantId,
      isWatchlisted,
    }: {
      restaurantId: string;
      isWatchlisted: boolean;
    }) => {
      if (isWatchlisted) {
        await removeFromWatchlist(restaurantId);
      } else {
        await addToWatchlist(restaurantId);
      }
    },
    onSuccess: (_, { restaurantId }) => {
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["watchlist", restaurantId] });
    },
  });
}
