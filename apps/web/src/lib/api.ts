import type { RestaurantDetail, RestaurantIndex } from '../types';

// Static data published by the pipeline into public/data/ — served by this
// same site, so all fetches are relative.
async function fetchJson<T>(path: string): Promise<T> {
  const resp = await fetch(`/data${path}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${path}`);
  return resp.json() as Promise<T>;
}

export function fetchIndex(): Promise<RestaurantIndex> {
  return fetchJson<RestaurantIndex>('/index.json');
}

export function fetchRestaurant(id: string): Promise<RestaurantDetail> {
  return fetchJson<RestaurantDetail>(`/r/${encodeURIComponent(id)}.json`);
}
