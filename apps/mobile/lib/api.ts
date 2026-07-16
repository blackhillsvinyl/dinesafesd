import { WEB_BASE_URL } from '../constants/links';
import type { Restaurant, RestaurantDetail, RestaurantIndex } from '../types';

// Static data published by the pipeline (see services/data-pipeline/src/lib/store.ts).
// Override locally with EXPO_PUBLIC_DATA_URL (e.g. http://localhost:5173/data
// while running the web app's dev server, which serves the same files).
const DATA_URL = process.env.EXPO_PUBLIC_DATA_URL ?? `${WEB_BASE_URL}/data`;

async function fetchJson<T>(path: string): Promise<T> {
  const resp = await fetch(`${DATA_URL}${path}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${path}`);
  return resp.json() as Promise<T>;
}

export function fetchIndex(): Promise<RestaurantIndex> {
  return fetchJson<RestaurantIndex>('/index.json');
}

export function fetchRestaurant(id: string): Promise<RestaurantDetail> {
  return fetchJson<RestaurantDetail>(`/r/${encodeURIComponent(id)}.json`);
}

/** Haversine distance in meters (replaces the PostGIS nearby RPC). */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export type { Restaurant, RestaurantDetail, RestaurantIndex };
